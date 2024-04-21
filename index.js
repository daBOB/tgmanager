import { Api, TelegramClient } from "telegram";
import { StoreSession } from "telegram/sessions";
const input = require("input"); 
const fs = require("fs");
const { program } = require("commander");
const Uploader = require("./Uploader.js");
import path  from 'path';



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
};

const accounts = { nitewalker, masterclass };

const startClient = async (account_name) => {
  const configDir = path.join('/', 'sessions',account_name);
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
  console.log(client.session.save()); // Save this string to avoid logging in again
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
  .requiredOption("-c, --command <command>", "Command to execute")
  .requiredOption("-i, --chat-id <id>", "Chat ID")
  .requiredOption("-f, --file-path <path>", "File path")
  .option("--delete-source", "Delete the source file after the operation");

program.parse(process.argv);

const options = program.opts();

const main = async () => {
  const { account, command, chatId, filePath, deleteSource } = options;

  console.log(
    "Command:",
    command,
    "Account",
    account,
    "ChatId",
    chatId,
    "Filepath",
    filePath
  );

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File does not exist at path ${filePath}`);
    process.exit(1);
  }

  if (!account == "nitewalker" || !account == "masterclass") {
    console.log("Invalid account");
    process.exit(1);
  }

  const client = await startClient(account);

  const isPremiumAccount = await isPremium(client);
  console.log("isPremium:", isPremiumAccount);

  const fileSizeInGiB = getFileSizeInGiB(filePath);
  const fileSizeLimit = isPremiumAccount ? 4 : 2; // 4 GiB for premium, 2 GiB for non-premium

  if (fileSizeInGiB > fileSizeLimit) {
    console.error(
      `Error: File size exceeds the limit of ${fileSizeLimit} GiB for ${
        isPremiumAccount ? "premium" : "non-premium"
      } accounts`
    );
    process.exit(1);
  }

  if (command === "upload" && chatId && filePath) {
    const uploader = new Uploader(client);
    const success = await uploader.uploadFile(chatId, filePath);
    if (success && deleteSource) {
      fs.unlinkSync(filePath);
      console.log(`Deleted source file: ${filePath}`);
    }

    if (!success) {
      console.error("Failed to upload file");
      process.exit(1);
    }
    process.exit(0);
  }
};

main();
