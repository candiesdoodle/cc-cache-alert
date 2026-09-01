#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import prompts from 'prompts';
import { loadConfig, saveConfig, CONFIG_FILE } from './config.js';
import { sendTelegramMessage, verifyTelegramCredentials } from './telegram.js';
import { installClaudeHooks, uninstallClaudeHooks, areHooksInstalled } from './hooks.js';
import { scheduleTimer, cancelTimer, executeTimer, listActiveTimers } from './timer-daemon.js';
import { getTranscriptCacheState, findActiveClaudeTranscripts } from './transcript.js';
import {
  renderWidget,
  renderStandaloneStatusline,
  hasCcstatuslineConfig,
  isWidgetInstalledInCcstatusline,
  installWidgetInCcstatusline,
  uninstallWidgetFromCcstatusline,
  StdinPayload
} from './statusline.js';

const program = new Command();

program
  .name('cc-cache-alert')
  .description('Telegram notifications before your Claude Code prompt cache expires')
  .version('1.0.0');

async function readStdin(): Promise<string> {
  let input = '';
  process.stdin.setEncoding('utf-8');
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) {
      input += chunk;
    }
  }
  return input;
}

/**
 * Setup Wizard Command
 */
program
  .command('setup')
  .description('Interactive setup wizard for Telegram credentials & Claude Code hooks')
  .action(async () => {
    console.log(pc.cyan('\n🚀 Welcome to cc-cache-alert Setup Wizard\n'));

    const currentConfig = loadConfig();

    const response = await prompts([
      {
        type: 'text',
        name: 'botToken',
        message: 'Enter your Telegram Bot Token (from @BotFather):',
        initial: currentConfig.telegram.botToken,
        validate: (val: string) => (val.trim().length > 0 ? true : 'Bot Token is required'),
      },
      {
        type: 'text',
        name: 'chatId',
        message: 'Enter your Telegram Chat ID (e.g. from @userinfobot):',
        initial: currentConfig.telegram.chatId,
        validate: (val: string) => (val.trim().length > 0 ? true : 'Chat ID is required'),
      },
      {
        type: 'select',
        name: 'ttlSeconds',
        message: 'Select Claude Code Prompt Cache TTL:',
        choices: [
          { title: '1 Hour (3600s) — Recommended for large project sessions', value: 3600 },
          { title: '5 Minutes (300s) — Default Anthropic ephemeral TTL', value: 300 },
        ],
        initial: currentConfig.cache.ttlSeconds === 300 ? 1 : 0,
      },
      {
        type: 'number',
        name: 'alertThresholdPercent',
        message: 'Alert when remaining cache time drops below (%):',
        initial: currentConfig.cache.alertThresholdPercent,
        min: 5,
        max: 50,
      },
      {
        type: 'confirm',
        name: 'installHooks',
        message: 'Automatically install hooks into ~/.claude/settings.json?',
        initial: true,
      },
    ]);

    if (!response.botToken || !response.chatId) {
      console.log(pc.yellow('\nSetup cancelled.'));
      return;
    }

    console.log(pc.gray('\nVerifying Telegram connection...'));
    const testResult = await verifyTelegramCredentials(response.botToken, response.chatId);

    if (!testResult.ok) {
      console.log(pc.red(`❌ Telegram verification failed: ${testResult.error}`));
      const retry = await prompts({
        type: 'confirm',
        name: 'saveAnyway',
        message: 'Save configuration anyway?',
        initial: false,
      });
      if (!retry.saveAnyway) return;
    } else {
      console.log(pc.green(`✓ Telegram verified! Connected to bot: @${testResult.botName}`));
    }

    currentConfig.telegram.botToken = response.botToken;
    currentConfig.telegram.chatId = response.chatId;
    currentConfig.telegram.enabled = true;
    currentConfig.cache.ttlSeconds = response.ttlSeconds;
    currentConfig.cache.alertThresholdPercent = response.alertThresholdPercent;

    saveConfig(currentConfig);
    console.log(pc.green(`✓ Saved configuration to ${CONFIG_FILE}`));

    if (response.installHooks) {
      const hookRes = installClaudeHooks();
      if (hookRes.success) {
        console.log(pc.green(`✓ ${hookRes.message}`));
      } else {
        console.log(pc.red(`❌ ${hookRes.message}`));
      }
    }

    // Check for ccstatusline configuration
    if (hasCcstatuslineConfig()) {
      const widgetPrompt = await prompts({
        type: 'confirm',
        name: 'addWidget',
        message: 'Detected ccstatusline! Would you like to add the cc-cache-alert indicator widget to your statusline?',
        initial: true,
      });

      if (widgetPrompt.addWidget) {
        const widgetRes = installWidgetInCcstatusline();
        if (widgetRes.success) {
          console.log(pc.green(`✓ ${widgetRes.message}`));
        } else {
          console.log(pc.red(`❌ ${widgetRes.message}`));
        }
      }
    }

    console.log(pc.cyan('\n🎉 Setup complete! You are ready to go.\n'));
  });

/**
 * Statusline Widget (Called by ccstatusline custom-command)
 */
program
  .command('widget')
  .description('Output compact widget text for ccstatusline')
  .action(async () => {
    let payload: StdinPayload | undefined;
    const input = await readStdin();
    if (input.trim()) {
      try {
        payload = JSON.parse(input);
      } catch {
        // ignore
      }
    }

    const output = renderWidget(payload);
    if (output) {
      process.stdout.write(output);
    }
  });

/**
 * Standalone Statusline (For users without ccstatusline)
 */
program
  .command('statusline')
  .description('Render standalone statusline for Claude Code')
  .action(async () => {
    let payload: StdinPayload | undefined;
    const input = await readStdin();
    if (input.trim()) {
      try {
        payload = JSON.parse(input);
      } catch {
        // ignore
      }
    }

    const output = renderStandaloneStatusline(payload);
    process.stdout.write(output + '\n');
  });

/**
 * Install / Uninstall Widget in ccstatusline
 */
program
  .command('install-widget')
  .description('Add cc-cache-alert widget to ~/.config/ccstatusline/settings.json')
  .action(() => {
    const res = installWidgetInCcstatusline();
    if (res.success) {
      console.log(pc.green(`✓ ${res.message}`));
    } else {
      console.log(pc.red(`❌ ${res.message}`));
    }
  });

program
  .command('uninstall-widget')
  .description('Remove cc-cache-alert widget from ~/.config/ccstatusline/settings.json')
  .action(() => {
    const res = uninstallWidgetFromCcstatusline();
    if (res.success) {
      console.log(pc.green(`✓ ${res.message}`));
    } else {
      console.log(pc.red(`❌ ${res.message}`));
    }
  });

/**
 * Test Command
 */
program
  .command('test')
  .description('Send a test alert to your Telegram chat')
  .action(async () => {
    const config = loadConfig();
    if (!config.telegram.botToken || !config.telegram.chatId) {
      console.log(pc.red('❌ Telegram is not configured yet. Run `cc-cache-alert setup` first.'));
      return;
    }

    console.log(pc.gray('Sending test notification...'));
    const res = await sendTelegramMessage({
      botToken: config.telegram.botToken,
      chatId: config.telegram.chatId,
      message: '🔔 *cc-cache-alert test notification*\n\nEverything is working properly!',
    });

    if (res.ok) {
      console.log(pc.green('✓ Test notification sent successfully to Telegram!'));
    } else {
      console.log(pc.red(`❌ Failed to send message: ${res.description}`));
    }
  });

/**
 * Status Command
 */
program
  .command('status')
  .description('Show active Claude sessions, cache expiration timers, and hook status')
  .action(() => {
    const config = loadConfig();
    const hooksActive = areHooksInstalled();
    const widgetInstalled = isWidgetInstalledInCcstatusline();

    console.log(pc.bold(pc.cyan('\n📊 cc-cache-alert Status\n')));
    console.log(`• Telegram:        ${config.telegram.enabled && config.telegram.botToken ? pc.green('Configured') : pc.red('Not configured')}`);
    console.log(`• Claude Hooks:    ${hooksActive ? pc.green('Installed (~/.claude/settings.json)') : pc.yellow('Not installed')}`);
    console.log(`• Statusline Widget: ${widgetInstalled ? pc.green('Installed in ccstatusline') : pc.gray('Not installed')}`);
    console.log(`• Cache TTL:       ${pc.white(config.cache.ttlSeconds >= 3600 ? `${config.cache.ttlSeconds / 3600}h` : `${config.cache.ttlSeconds / 60}m`)}`);
    console.log(`• Alert Threshold: ${pc.white(`${config.cache.alertThresholdPercent}% remaining`)} (~${Math.round((config.cache.ttlSeconds * config.cache.alertThresholdPercent) / 6000)}m)`);

    const activeTimers = listActiveTimers();
    console.log(pc.bold('\n🕒 Pending Background Timers:'));
    if (activeTimers.length === 0) {
      console.log(pc.gray('  (No active timers running)'));
    } else {
      for (const t of activeTimers) {
        const remainingSec = Math.max(0, Math.round((t.fireAt - Date.now()) / 1000));
        console.log(`  - [PID ${t.pid}] ${pc.cyan(t.projectName)} (Session: ${t.sessionId.slice(0, 8)}): Alert in ${pc.yellow(`${Math.round(remainingSec / 60)}m ${remainingSec % 60}s`)}`);
      }
    }

    const activeTranscripts = findActiveClaudeTranscripts().slice(0, 5);
    console.log(pc.bold('\n📂 Recent Claude Code Sessions:'));
    if (activeTranscripts.length === 0) {
      console.log(pc.gray('  (No recent transcripts found in ~/.claude/projects)'));
    } else {
      for (const t of activeTranscripts) {
        const state = getTranscriptCacheState(t.transcriptPath, config.cache.ttlSeconds, config.cache.alertThresholdPercent);
        let statusStr = '';
        if (state.isWorking) {
          statusStr = pc.green('🔥 WORKING (Cache Hot)');
        } else if (state.isExpired) {
          statusStr = pc.gray('❄️ COLD (Expired)');
        } else if (state.isExpiringSoon) {
          statusStr = pc.red(`🔴 EXPIRING SOON (~${Math.round(state.remainingSeconds / 60)}m left)`);
        } else {
          statusStr = pc.cyan(`🟢 WARM (~${Math.round(state.remainingSeconds / 60)}m left)`);
        }
        console.log(`  - ${pc.bold(t.project)} [${t.sessionId.slice(0, 8)}]: ${statusStr}`);
      }
    }
    console.log('');
  });

/**
 * Install / Uninstall Hooks
 */
program
  .command('install')
  .description('Install hooks into ~/.claude/settings.json')
  .action(() => {
    const res = installClaudeHooks();
    if (res.success) {
      console.log(pc.green(`✓ ${res.message}`));
    } else {
      console.log(pc.red(`❌ ${res.message}`));
    }
  });

program
  .command('uninstall')
  .description('Remove hooks from ~/.claude/settings.json')
  .action(() => {
    const res = uninstallClaudeHooks();
    if (res.success) {
      console.log(pc.green(`✓ ${res.message}`));
    } else {
      console.log(pc.red(`❌ ${res.message}`));
    }
  });

/**
 * Claude Code Hook Handlers
 */
program
  .command('on-stop')
  .description('Internal hook called when Claude finishes an assistant turn')
  .action(async () => {
    const config = loadConfig();
    if (!config.telegram.enabled || !config.telegram.botToken) return;

    const inputPayload = await readStdin();
    let transcriptPath = '';
    let sessionId = '';
    let projectName = '';

    if (inputPayload.trim()) {
      try {
        const parsed = JSON.parse(inputPayload);
        transcriptPath = parsed.transcript_path || parsed.transcriptPath || '';
        sessionId = parsed.session_id || parsed.sessionId || '';
        projectName = parsed.project_name || parsed.projectName || '';
      } catch {
        // ignore
      }
    }

    if (!transcriptPath) {
      const active = findActiveClaudeTranscripts();
      if (active.length > 0) {
        transcriptPath = active[0].transcriptPath;
        sessionId = active[0].sessionId;
        projectName = active[0].project;
      }
    }

    if (!transcriptPath || !sessionId) return;

    const state = getTranscriptCacheState(transcriptPath, config.cache.ttlSeconds, config.cache.alertThresholdPercent);
    if (!state.lastAssistantTime) return;

    // Delay until remaining time hits the threshold (e.g. 80% elapsed / 48 mins)
    const alertDelaySeconds = Math.max(1, state.remainingSeconds - (config.cache.ttlSeconds * (config.cache.alertThresholdPercent / 100)));

    scheduleTimer({
      sessionId,
      transcriptPath,
      projectName,
      delaySeconds: alertDelaySeconds,
      ttlSeconds: config.cache.ttlSeconds,
    });
  });

program
  .command('on-submit')
  .description('Internal hook called when user submits a new prompt')
  .action(async () => {
    const inputPayload = await readStdin();
    let sessionId = '';
    if (inputPayload.trim()) {
      try {
        const parsed = JSON.parse(inputPayload);
        sessionId = parsed.session_id || parsed.sessionId || '';
      } catch {
        // ignore
      }
    }

    if (!sessionId) {
      const active = findActiveClaudeTranscripts();
      if (active.length > 0) {
        sessionId = active[0].sessionId;
      }
    }

    if (sessionId) {
      cancelTimer(sessionId);
    }
  });

/**
 * Internal background timer runner
 */
program
  .command('internal-timer <sessionId> <delaySeconds>')
  .description('Internal background timer worker')
  .action(async (sessionId: string, delaySecondsStr: string) => {
    const delaySec = Number.parseInt(delaySecondsStr, 10);
    if (Number.isNaN(delaySec) || delaySec <= 0) return;

    await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
    await executeTimer(sessionId);
  });

program.parse(process.argv);
