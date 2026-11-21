// PM2 process file. On the server: pm2 startOrReload ecosystem.config.cjs --update-env
// Secrets come from /var/www/pingzest/shared/.env (never committed).
module.exports = {
  apps: [
    {
      name: "pingzest",
      cwd: "/var/www/pingzest/current",
      script: "./node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      interpreter: "node",
      node_args: "--env-file=/var/www/pingzest/shared/.env",
      exec_mode: "fork", // one process is plenty on a 1 GB server; switch to "cluster" + instances: 2 on 2 GB+
      instances: 1,
      env: { NODE_ENV: "production", PORT: "3000", HOST: "127.0.0.1" },
      max_memory_restart: "450M", // restart before the server runs out of memory
      kill_timeout: 8000, // time to finish requests and send the last PostHog events
      listen_timeout: 15000,
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      out_file: "/var/www/pingzest/shared/logs/out.log",
      error_file: "/var/www/pingzest/shared/logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
