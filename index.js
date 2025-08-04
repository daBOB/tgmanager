const { Api, TelegramClient } = require("telegram");
const { StoreSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const os = require("os");
const { program } = require("commander");
const Uploader = require("./Uploader.js");
const path = require("path");
const config = require("./config.js");
const logger = require("./logger.js");
const { validatePath, validateChatId, validateAccountName, validateCommand, sanitizeInput } = require("./utils/validation.js");

const startClient = async (account_name) => {
  const configDir = path.join(config.app.sessionDir, account_name);
  // Ensure the config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  logger.debug(`Session directory: ${configDir}`);
  const storeSession = new StoreSession(configDir);
  
  // Validate account exists
  const accountConfig = config.accounts[account_name];
  if (!accountConfig) {
    throw new Error(`Account '${account_name}' not found in configuration`);
  }
  
  const { apiId, apiHash, phoneNumber, password } = accountConfig;

  const client = new TelegramClient(storeSession, apiId, apiHash, {
    connectionRetries: config.telegram.connectionRetries,
    useWSS: config.telegram.useWSS
  });

client.on("disconnect", (err) => {
  if (err) {
    logger.error("Client disconnected with error", { error: err.message });
  } else {
    logger.info("Client disconnected");
  }
  process.exit(1);
});

client.on("error", (err) => {
  logger.error("Client error", { error: err.message, code: err.code });
});

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => password,
    phoneCode: async () =>
      await input.text("Please enter the code you received: "),
    onError: (err) => logger.error("Authentication error", { error: err.message }),
  });
  logger.info("Successfully connected to Telegram");
  client.session.save();
  return client;
};



const getFileSizeInGiB = (filePath) => {
  const stats = fs.statSync(filePath);
  return stats.size / 1024 ** 3; // Convert bytes to GiB
};

const isPremium = async (client) => {
  try {
    const result = await client.invoke(
      new Api.users.GetFullUser({
        id: "Me",
      })
    );
    if (!result || !result.users || result.users.length === 0) {
      logger.warn("isPremium: Invalid result from API");
      return false;
    }
    const { premium } = result.users[0];
    if (!premium) {
      logger.debug("isPremium: User does not have premium");
      return false;
    }
    return premium;
  } catch (error) {
    logger.error("Failed to check premium status", { error: error.message });
    return false;
  }
};

program
  .requiredOption("-a, --account <account>", "Account name")
  .option("-c, --command <command>", "Command to execute")
  .option("-i, --chat-id <id>", "Chat ID")
  .option("-f, --file-path <path>", "File path")
  .option("-n, --name <name>", "Name")
  .option("--delete-source", "Delete the source file after the operation");

program.parse(process.argv);

const options = program.opts();

const uploadSingleFile = async (client, chatId, filePath, deleteSource) => {
  const uploader = new Uploader(client);
  const success = await uploader.uploadFile(chatId, filePath);
  
  if (success && deleteSource) {
    try {
      fs.unlinkSync(filePath);
      logger.info(`Deleted source file: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete file`, { filePath, error: error.message });
    }
  }

  return success;
};

const main = async () => {
  try {
    const { account, command, chatId, filePath, deleteSource, name } = options;
    
    // Validate inputs
    validateCommand(command, options);
    validateAccountName(account, Object.keys(config.accounts));
    
    if (chatId) {
      validateChatId(chatId);
    }

    let uploadPath;
    if (filePath) {
      // Handle absolute paths correctly with validation
      if (filePath.startsWith('/')) {
        uploadPath = filePath;
      } else {
        uploadPath = validatePath(filePath, config.app.uploadDir);
      }
      
      // Ensure the uploads directory exists
      if (!fs.existsSync(config.app.uploadDir)) {
        fs.mkdirSync(config.app.uploadDir, { recursive: true });
      }
    }

    const client = await startClient(account);

    if (command === "upload" && chatId && uploadPath) {
      // Check if path exists
      if (!fs.existsSync(uploadPath)) {
        logger.error(`Path does not exist: ${uploadPath}`);
        process.exit(1);
      }

    const stats = fs.statSync(uploadPath);
    
    if (stats.isDirectory()) {
      // Handle directory
      const files = fs.readdirSync(uploadPath)
        .filter(file => !file.startsWith('.')) // Skip hidden files
        .map(file => path.join(uploadPath, file));
      
      logger.info(`Found ${files.length} files in directory ${uploadPath}`);
      
      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        logger.info(`Starting upload: ${path.basename(file)}`);
        const success = await uploadSingleFile(client, chatId, file, deleteSource);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      logger.info(`Upload batch complete`, {
        total: files.length,
        successful: successCount,
        failed: failCount
      });

      // Delete the source directory if requested and all files were uploaded successfully
      if (deleteSource && failCount === 0) {
        try {
          fs.rmSync(uploadPath, { recursive: false });
          logger.info(`Deleted source directory: ${uploadPath}`);
        } catch (error) {
          logger.error(`Failed to delete directory`, { path: uploadPath, error: error.message });
        }
      } else if (deleteSource && failCount > 0) {
        logger.warn(`Directory not deleted due to failed uploads`, { failCount });
      }
    } else {
      // Handle single file
      const success = await uploadSingleFile(client, chatId, uploadPath, deleteSource);
      if (!success) {
        logger.error("Failed to upload file");
        process.exit(1);
      }
    }
    process.exit(0);
  } else if (command === "create") {
    const sanitizedName = sanitizeInput(name);

    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: sanitizedName,
        about: "",
        broadcast: true,
        megagroup: false,
      })
    );
    const channelId = "-100" + result.chats[0].id.toJSNumber();
    logger.info("Channel created successfully", { channelId, name: sanitizedName });
    process.exit(0);
  }
  } catch (error) {
    logger.error("Fatal error", { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

main();
