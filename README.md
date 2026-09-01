# cc-cache-alert 🔔

> Telegram alerts and terminal statusline indicator before your **Claude Code CLI** prompt cache expires (1-hour & 5-minute TTL).

Never let your prompt cache go cold while you step away from your terminal. Built specifically for the **Claude Code CLI** (`claude`) and inspired by the prompt cache inspection techniques in [**ccstatusline**](https://github.com/sirmalloc/ccstatusline)), `cc-cache-alert` tracks your active Claude terminal sessions in real time, alerts your phone before Anthropic evicts your cached prompt prefix, and provides a companion countdown indicator for your terminal statusline.

Saving you **~90% on input token costs** and eliminating cold-start latency across long coding sessions.

---

## ⚡ Features

- 💻 **Built for Claude Code CLI:** Seamlessly integrates with official `claude code` CLI via native lifecycle hooks.
- 🧩 **ccstatusline Companion:** Integrates out of the box with [**ccstatusline**](https://github.com/sirmalloc/ccstatusline) via a dedicated companion widget (`cc-cache-alert install-widget`), or functions as a standalone statusline for users without it.
- 📲 **Telegram Notifications:** Alerts your phone with the project name, session ID, and remaining time before cache eviction.
- ⏱️ **Supports 1-Hour & 5-Minute TTL:** Configured for Anthropic's extended 1-hour cache breakpoints (or standard 5m).
- 📊 **Dynamic Statusline Indicator:**
  - **Active / Turn in flight:** `Cache 🔔 active`
  - **Idle / Countdown:** `Cache 🔔 in XX m` (e.g. `Cache 🔔 in 34 m`)
  - **Alert Dispatched (< 12m left):** `Alerted`
  - **Cache Expired:** `Alerted-Cold`
  - **Standalone Mode:** Purely cache-focused (no clutter from model name or session cost).
- 🎯 **Smart Reverse Tail Scanner:** Reads only the last 32 KB of Claude Code transcripts with zero performance overhead.
- 🔄 **Auto-Cancelling Timers:** As soon as you type or submit a prompt, pending alert timers are automatically canceled.
- ⚙️ **One-Command Setup Wizard:** Interactive setup wizard that configures Telegram credentials, hooks, and statusline widgets.

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
5. Detect if `ccstatusline` is installed and offer to add the alert indicator widget!

---

## 📊 Statusline Integration

### With `ccstatusline`:
Run:
```bash
cc-cache-alert install-widget
```
- If the `cache-timer` widget is enabled in `ccstatusline`, it automatically places `cc-cache-alert` right next to it on the first line.
- If `cache-timer` is not enabled, it adds `cc-cache-alert` as an additional custom widget on the first line.

> **💡 Suggested Setup:**
> In `ccstatusline`, we recommend enabling the built-in `cache-timer` widget and placing `cc-cache-alert` right next to it. Together, they display both the live TTL countdown and your Telegram alert timer:
> ```text
> [Sonnet 4.6]  [🟢 54:12]  [Cache 🔔 in 34 m]  [Session $0.42]
>                 ▲                  ▲
>                 │                  └── cc-cache-alert (time until Telegram alert)
>                 └───────────────────── ccstatusline cache-timer (live TTL countdown)
> ```

### Without `ccstatusline` (Standalone Mode):
In `~/.claude/settings.json`:
```json
"statusLine": {
  "type": "command",
  "command": "cc-cache-alert statusline"
}
```
Renders strictly cache-related information:
```text
🟢 Cache: ~52 m / 1h │ Cache 🔔 in 40 m
```

---

## 💻 CLI Commands

```bash
# Run interactive setup wizard
cc-cache-alert setup

# Send a test alert to your Telegram chat
cc-cache-alert test

# View active Claude sessions, cache countdowns, and timers
cc-cache-alert status

# Add widget to ~/.config/ccstatusline/settings.json
cc-cache-alert install-widget

# Remove widget from ccstatusline
cc-cache-alert uninstall-widget

# Manually install hooks into ~/.claude/settings.json
cc-cache-alert install

# Remove hooks from ~/.claude/settings.json
cc-cache-alert uninstall
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
    "includeSessionName": true
  }
}
```

> **Note on `includeSessionName`:** Sends the custom session name set via Claude Code's `/rename` command (or the session slug like `magical-meandering-bird`), making alerts easily identifiable.

---

## 🙏 Credits & Acknowledgments

- Thanks to [**@sirmalloc**](https://github.com/sirmalloc) for the [**ccstatusline**](https://github.com/sirmalloc/ccstatusline) project.

---

## 📄 License

MIT © [candiesdoodle](https://github.com/candiesdoodle)
