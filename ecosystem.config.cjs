const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "ledger",
      cwd: __dirname,
      script: path.join(__dirname, "dist", "server.js"),
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000,
    },
  ],
};
