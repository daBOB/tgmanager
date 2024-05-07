const { Api, TelegramClient } = require("telegram");
const { StoreSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const { program } = require("commander");
const Uploader = require("./Uploader.js");
const path = require("path");

const nitewalker = {
  apiId: 28686654,
  apiHash: "87c9aff2fb7a74881b56c42e9e204a1d",
  phoneNumber: "+31617940932",
  password: "eexooRie9U",
};

const masterclass = {
  apiId: 24926787,
  apiHash: "46b0509502f455dab0feb762c5e2f18b",
  phoneNumber: "+447389674740",
  password: "eexooRie9U",
};

const junkies = {
  apiId: 29270640,
  apiHash: "b61327fb786f144b307892ef7d62e32c",
  phoneNumber: "+37064003188",
  password: "eexooRie9U",
};

const accounts = { nitewalker, masterclass, junkies };

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
    connectionRetries: 5,
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

const main = async () => {
  const { account, command, chatId, filePath, deleteSource, name } = options;
  const uploadPath = `uploads/${filePath}`;

  // console.log(
  //   "Command:",
  //   command,
  //   "Account",
  //   account,
  //   "ChatId",
  //   chatId,
  //   "Filepath",
  //   filePath
  // );

  const client = await startClient(account);

  if (command === "upload" && chatId && uploadPath) {
    // Check if the file exists
    if (!fs.existsSync(uploadPath)) {
      console.error(`Error: File does not exist at path ${uploadPath}`);
      process.exit(1);
    }

    const isPremiumAccount = await isPremium(client);
    const fileSizeInGiB = getFileSizeInGiB(uploadPath);
    const fileSizeLimit = isPremiumAccount ? 4 : 2; // 4 GiB for premium, 2 GiB for non-premium

    if (fileSizeInGiB > fileSizeLimit) {
      console.error(
        `Error: File size exceeds the limit of ${fileSizeLimit} GiB for ${
          isPremiumAccount ? "premium" : "non-premium"
        } accounts`
      );
      process.exit(1);
    }

    const uploader = new Uploader(client);
    const success = await uploader.uploadFile(chatId, uploadPath);
    if (success && deleteSource) {
      fs.unlinkSync(uploadPath);
      console.log(`Deleted source file: ${uploadPath}`);
    }

    if (!success) {
      console.error("Failed to upload file");
      process.exit(1);
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
