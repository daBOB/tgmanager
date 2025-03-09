const { Api, TelegramClient } = require("telegram");
const { StoreSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const { program } = require("commander");
const Uploader = require("./Uploader.js");
const path = require("path");
const accounts = require("./accounts.js");

const startClient = async (account_name) => {
  const configDir = path.join("sessions", account_name);
  // Ensure the config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  //console.log("Config directory:", configDir);
  const storeSession = new StoreSession(configDir);
  const { apiId, apiHash, phoneNumber, password } = accounts[account_name];

  const client = new TelegramClient(storeSession, apiId, apiHash, {
    connectionRetries: 50,
    useWSS: true
  });

client.on("disconnect", (err) => {
  if (err) {
    console.error("Client disconnected with error:", err);
  } else {
    console.log("Client disconnected");
  }
  process.exit(1);
});

client.on("error", (err) => {
  console.error("Client error:", err);
});

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => password,
    phoneCode: async () =>
      await input.text("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });
  console.log("You should now be connected.");
  client.session.save();
  //console.log(client.session.save()); // Save this string to avoid logging in again
  return client;
  //await client.sendMessage("me", { message: "Hello!" });
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
      console.error("isPremium: result is null or invalid");
      return false;
    }
    const { premium } = result.users[0];
    if (!premium) {
      console.error("isPremium: premium is null");
      return false;
    }
    return premium;
  } catch (error) {
    console.error("isPremium: Error", error);
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
      console.log(`Deleted source file: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete file ${filePath}:`, error.message);
    }
  }

  return success;
};

const main = async () => {
  const { account, command, chatId, filePath, deleteSource, name } = options;

  // Handle absolute paths correctly
  const uploadPath = filePath.startsWith('/') ? filePath : `uploads/${filePath}`;

  const client = await startClient(account);

  if (command === "upload" && chatId && uploadPath) {
    // Check if path exists
    if (!fs.existsSync(uploadPath)) {
      console.error(`Error: Path does not exist: ${uploadPath}`);
      process.exit(1);
    }

    const stats = fs.statSync(uploadPath);
    
    if (stats.isDirectory()) {
      // Handle directory
      const files = fs.readdirSync(uploadPath)
        .filter(file => !file.startsWith('.')) // Skip hidden files
        .map(file => path.join(uploadPath, file));
      
      console.log(`Found ${files.length} files in directory`);
      
      let successCount = 0;
      let failCount = 0;

      for (const file of files) {
        console.log(`\nUploading: ${path.basename(file)}`);
        const success = await uploadSingleFile(client, chatId, file, deleteSource);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      console.log(`\nUpload complete:`);
      console.log(`Successfully uploaded: ${successCount} files`);
      console.log(`Failed to upload: ${failCount} files`);

      // Delete the source directory if requested and all files were uploaded successfully
      if (deleteSource && failCount === 0) {
        try {
          fs.rmdirSync(uploadPath);
          console.log(`Deleted source directory: ${uploadPath}`);
        } catch (error) {
          console.error(`Failed to delete directory ${uploadPath}:`, error.message);
        }
      } else if (deleteSource && failCount > 0) {
        console.warn(`Directory not deleted due to ${failCount} failed uploads`);
      }
    } else {
      // Handle single file
      const success = await uploadSingleFile(client, chatId, uploadPath, deleteSource);
      if (!success) {
        console.error("Failed to upload file");
        process.exit(1);
      }
    }
    process.exit(0);
  } else if (command === "create") {
    if (!name) {
      console.error("Error: Name is required for the create command.");
      process.exit(1);
    }

    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: name,
        about: "",
        broadcast: true,
        megagroup: false,
      })
    );
    const channelId = "-100" + result.chats[0].id.toJSNumber();
    console.log("Channel ID:", channelId);
    // Add your code for the create command here
    console.log(`Creating with name: ${name}`);
    process.exit(0);
  }
};

main();
