// Konfiguracja pm2 — trzyma hosta 24/7 (restart po crashu, autostart po reboocie).
// Użycie:  pm2 start ecosystem.config.js  &&  pm2 save  &&  pm2 startup
module.exports = {
  apps: [
    {
      name: "pitole-host",
      script: "host.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      time: true,
    },
  ],
};
