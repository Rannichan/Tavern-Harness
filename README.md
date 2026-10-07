# Tavern Harness · An AI-Native Role-Playing Sandbox

[GitHub Repository](https://github.com/Rannichan/Tavern-Harness) · [Product Site](https://rannichan.github.io/Tavern-Harness/) · [Open Sandbox](https://rannichan.github.io/Tavern-Harness/#world) · [Report an Issue](https://github.com/Rannichan/Tavern-Harness/issues) · [Discussions](https://github.com/Rannichan/Tavern-Harness/discussions) · [Discord](https://discord.gg/kPSWGeaHx) · [Skill Sandbox Design](./notebook/skill-sandbox-design.md)

<a id="run"></a>
## 1 · Getting Started

> Requires **Node.js 18 or later**. Tavern Harness is a frontend web app with an optional local sandbox service—no Docker or database server required.

### Option 1: One-Command Start (Recommended)

No repository clone or global installation is required:

```bash
npx tavern-harness
```

The first run downloads the package, starts the local service, and opens your browser automatically. Optional arguments:

```bash
npx tavern-harness --no-open
npx tavern-harness --port 5273
```

The service listens only on the local machine. When using shell skills, commands run locally with the permissions of the user who started the command. Run only versions from trusted sources and review every command-confirmation dialog.

### Option 2: Develop from Source

```bash
git clone https://github.com/Rannichan/Tavern-Harness.git
cd Tavern-Harness
npm install
npm run dev      # Defaults to port 5173 and automatically tries the next port if occupied
```

### Configure a Model Provider on First Launch

After starting the app, open **Settings → Model Service Provider**:

1. **Add a provider**: enter a name, Base URL, and API Key. Any OpenAI-compatible `chat/completions` API is supported, including OpenAI, DeepSeek, Qwen, SiliconFlow, Ollama, LM Studio, and self-hosted vLLM.
2. **Test the connection**: the app fetches the model list automatically. If the target service does not expose CORS headers, requests are forwarded through the built-in same-origin proxy for private-network or LAN addresses. On success, the Base URL is rewritten to its proxy form and saved.
3. **Select a model**: click the model name at the top of the chat page, then return to the conversation and start chatting.

### Data Privacy

- **All data is stored in browser IndexedDB**: conversations, character cards, lorebooks, skills, statistics, and API keys are not uploaded to any server.
- Data is tied to the browser, port, and site origin. Switching browsers, opening a private window, or using a different port will not show existing data. This is expected browser security behavior; use the same browser and port each time.

<a id="features"></a>
## 2 · Features

### 🍺 The Tavern Keeper Is Always Ready to Help

Whether you are creating a character card, designing a tabletop RPG scenario, or simply unsure where to begin, ask the Tavern Keeper.

The tavern is designed around AI assistance to make creating and playing games easier.

### 🛠️ Skill System

Characters are more than chat partners: they are **agents with extensible skills**. Equip each character with the abilities needed for richer gameplay.

The tavern includes essential skills such as dice rolling. You can also ask the Tavern Keeper to **create any skill you need**.

### 💬 Multi-Character Group Chats

Each room supports up to **six characters** and provides a turn-order board for managing group conversations.

Use **@mentions** and **skip** to create natural multi-character scenes—whether observing from above or role-playing as part of the group.

### 🎁 Share Your Game with Friends

Compatible with the **Tavern ecosystem**, including one-click PNG character-card imports.

You can also export and share an entire game: recipients can import it and play immediately without manually creating characters, skills, or conversation settings.

### 🍃 Fully Local and Clean

The app supports **OpenAI-format APIs**. Use a hosted API plan or run a model locally; your data remains on your device.

The project has no external harness dependency, and its UI is designed for a clean, focused experience.

<a id="gameplay"></a>
## 3 · Gameplay Examples

> These examples progress from simple to advanced: the first three work out of the box, while the remaining four gradually introduce sandbox capabilities. In every example, “the Keeper” means the built-in **Tavern Keeper** character, which exists on first launch and has all built-in skills enabled by default.

### Example 1: Late-Night Company (No Setup)

1. Create a new conversation → select **NPC Chat** → choose **Tavern Keeper** or any custom character.
2. Chat naturally as you would with a friend. Enable **thinking mode** to see the Keeper's reasoning.
3. Long-press or right-click any message to edit history, regenerate, inspect raw logs, or fork a branch.

### Example 2: Tabletop Dice Rolls (Role-Playing)

1. Create an **NPC Chat** for a GM and give the character a prompt such as: “You are the GM for this campaign; use `roll_dice` to decide fate.”
2. Use the opening message to introduce a story hook. The Keeper can call `roll_dice` and display results such as critical successes or failures.
3. Add campaign rules and world setting to a Lorebook, then bind it to the conversation to turn the character into a complete world.

### Example 3: A Group-Chat Script (Up to Six Characters)

1. Create multiple NPCs in the **Character Workshop**, such as a detective, butler, and protagonist.
2. Create a **Group Chat**, add up to six characters, drag to set their speaking order, or enable random ordering.
3. Use `@character-name` to choose the next speaker. Enter `/new` to begin a new topic with truncated context, or `/pass` to skip your turn.

### Example 4: Create Skills in the Moment

1. Ask the Keeper: “Create a skill that accepts a city and returns the weather.” It can call `create_skill` to create a new `template` or `http_get` skill.
2. New skills are disabled for all characters by default. Enable them for the desired character in **Character Workshop → Skills**.
3. Skills can use `$read`, `$write`, `$append`, and `$list` to work with the conversation workspace, with no restart required.

### Example 5: A Persistent Mini-Game (Advanced Sandbox)

1. Ask the Keeper to write a `javascript` skill for an affinity system, saving each turn's value to `state.json` with `$write`.
2. Create another skill that reads with `$read` and uses `file_write` to generate an HTML dashboard, `dashboard.html`.
3. Use `file_display` to visualize value changes in a pop-up; workspace files can be previewed in an isolated, resizable HTML view.
4. Deleting the conversation also removes its `sandbox_workspace/session-<id>/` directory.

### Example 6: Organize Files with Shell Skills

1. Ask the Keeper in chat to use `ls` to inspect the workspace, `cat` to read files, and `cp` to archive creative work.
2. Reads and writes must remain in the current conversation workspace. Non-allowlisted commands such as `node` and `git`, plus modifying operations such as `mv` and `rm`, require confirmation.
3. Regular conversations have read-only access to `public/`. Only the built-in Tavern Keeper can write to the public area, allowing shared assets across conversations.

### Example 7: Take an Entire World with You (Import, Export, and Fork)

1. Mid-game, choose **Export Game** and decide whether to include conversation history to create a self-contained JSON file.
2. Send the JSON to a friend, who can use **Import Game** to restore your characters and world in one step. Conflicts create copies instead of overwriting data.
3. Or create a branch / fork to explore multiple endings from the same history.

<a id="feedback"></a>
## 4 · Community and Feedback

- 🐛 Found a bug or have a feature request? Open a [GitHub Issue](https://github.com/Rannichan/Tavern-Harness/issues). You are welcome to attach exported game JSON or browser-console logs, but always remove API keys first.
- 🟣 For usage discussions, gameplay ideas, character and skill sharing, or development updates, join the [Discord community](https://discord.gg/kPSWGeaHx).
- 🤝 Pull requests are welcome.
- 📣 Star or watch the repository to receive updates.

> The tavern is open 24 hours a day, and the Keeper is always here to help.
