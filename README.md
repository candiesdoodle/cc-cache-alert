# cc-cache-alert 🔔

> Telegram alerts before your **Claude Code** prompt cache expires (1-hour & 5-minute TTL).

Never let your prompt cache go cold while you step away from your terminal. `cc-cache-alert` tracks your Claude Code session in real time and sends a notification to your phone when cache expiration approaches, saving you ~90% on input tokens and eliminating cold-start latency.

---

## ⚡ Features

- 📲 **Telegram Notifications:** Alerts your phone with the project name, session ID, and remaining time before cache eviction.
- ⏱️ **Supports 1-Hour & 5-Minute TTL:** Configured for Anthropic's extended 1-hour cache breakpoints (or standard 5m).
- 🎯 **Smart Reverse Tail Scanner:** Reads only the last 32 KB of Claude Code transcripts with zero performance overhead.
- 🔄 **Auto-Cancelling Timers:** As soon as you type or submit a prompt, pending alert timers are automatically canceled.
- ⚙️ **One-Command Setup Wizard:** Interactive setup wizard that configures Telegram credentials and installs Claude Code hooks in `~/.claude/settings.json`.

---

## 🚀 Quickstart

Run the interactive setup wizard:

```bash
npx cc-cache-alert setup
```

The wizard will:
1. Prompt for your **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather)) and **Chat ID** (from [@userinfobot](https://t.me/userinfobot)).
2. Send a test ping to verify your Telegram connection.
3. Configure your Cache TTL (defaults to `1 hour` / `3600s`) and Alert Threshold (defaults to `20%` / 12 mins).
4. Automatically register the `Stop` and `UserPromptSubmit` hooks in `~/.claude/settings.json`.

---

## 💻 CLI Commands

```bash
# Run interactive setup & install hooks
npx cc-cache-alert setup

# Send a test alert to your Telegram chat
npx cc-cache-alert test

# View active Claude sessions and cache expiration countdowns
npx cc-cache-alert status

# Manually install hooks into ~/.claude/settings.json
npx cc-cache-alert install

# Remove hooks from ~/.claude/settings.json
npx cc-cache-alert uninstall
```

---

## 🏗️ How It Works

`cc-cache-alert` integrates directly into Claude Code's native lifecycle hooks:

```text
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code CLI                       │
└───────┬─────────────────────────────────────────────▲───────┘
        │ (1) Turn Finishes                           │ (4) User replies
        ▼                                             │
┌──────────────────────────────┐              ┌───────┴──────────────┐
│ Hook: Stop                   │              │ Hook: UserPromptSubmit
│ `cc-cache-alert on-stop`     │              │ `cc-cache-alert      │
└───────┬──────────────────────┘              │  on-submit`          │
        │ Spawns detached timer               └───────▲──────────────┘
        ▼                                             │ Cancels timer
┌──────────────────────────────────────────────┐      │
│ Detached Background Timer (48 mins)          ├──────┘
│ • Sleeps in background                       │
│ • Validates transcript is still idle         │
└───────┬──────────────────────────────────────┘
        │ (3) 48 mins elapsed (12 mins left)
        ▼
┌──────────────────────────────────────────────┐
│ Telegram Notification 📲                     │
│ ⚠️ Claude Code cache expiring in ~12m!       │
│ Project: my-app | Session: 6ed6c317          │
└──────────────────────────────────────────────┘
```

---

## 📁 Configuration File

Settings are stored at `~/.config/cc-cache-alert/config.json`:

```json
{
  "telegram": {
    "botToken": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ",
    "chatId": "987654321",
    "enabled": true
  },
  "cache": {
    "ttlSeconds": 3600,
    "alertThresholdPercent": 20
  },
  "notifications": {
    "sound": true,
    "includeProjectName": true,
    "includeSessionId": true
  }
}
```

---

## 🧪 Development & Testing

```bash
# Clone the repository
git clone https://github.com/candiesdoodle/cc-cache-alert.git
cd cc-cache-alert

# Install dependencies
npm install

# Run unit tests
npm test

# Build TypeScript to dist/
npm run build
```

---

## 📄 License

MIT © [candiesdoodle](https://github.com/candiesdoodle)
