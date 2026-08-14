import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { config, setPasswordCredentials } from "./config.js";
import { hashPassword, randomHex, verifyPassword } from "./crypto.js";

const MIN_PASSWORD_LENGTH = 10;

/** Read a secret from an interactive terminal without echoing it. */
function readSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal.");
  }

  return new Promise((resolve) => {
    let value = "";
    const wasRaw = input.isRaw;
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
    };
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        if (char === "\u0003") {
          cleanup();
          output.write("\nPassword reset cancelled.\n");
          process.exit(130);
        }
        if (char === "\u0004") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (char === "\b" || char === "\u007f") {
          if (value) value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    };

    output.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main(): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(config.masterKey)) {
    throw new Error("MASTER_KEY is missing or invalid. Restore the original key before resetting the password.");
  }

  const password = await readSecret("New Ledger password: ");
  const confirmation = await readSecret("Confirm new password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const passwordHash = hashPassword(password);
  if (!verifyPassword(password, passwordHash)) throw new Error("Password verification failed; no changes were saved.");
  setPasswordCredentials(passwordHash, randomHex(32));

  console.log("Ledger password reset successfully.");
  console.log(`Updated ${config.envPath}. MASTER_KEY and stored memory were not changed.`);
  console.log("Restart only Ledger with: pm2 restart ledger --update-env");
}

main().catch((error) => {
  console.error(`Password reset failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
