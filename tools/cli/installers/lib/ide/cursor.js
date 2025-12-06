const path = require('node:path');
const { BaseIdeSetup } = require('./_base-ide');
const chalk = require('chalk');
const { AgentCommandGenerator } = require('./shared/agent-command-generator');
const { WorkflowCommandGenerator } = require('./shared/workflow-command-generator');

/**
 * Cursor IDE setup handler
 */
class CursorSetup extends BaseIdeSetup {
  constructor() {
    super('cursor', 'Cursor', true); // preferred IDE
    this.configDir = '.cursor';
    this.commandsDir = 'commands';
  }

  /**
   * Cleanup old BMAD installation before reinstalling
   * @param {string} projectDir - Project directory
   */
  async cleanup(projectDir) {
    const fs = require('fs-extra');

    // Clean up new commands directory
    const bmadCommandsDir = path.join(projectDir, this.configDir, this.commandsDir, 'bmad');
    if (await fs.pathExists(bmadCommandsDir)) {
      await fs.remove(bmadCommandsDir);
      console.log(chalk.dim(`  Removed old BMAD commands from ${this.name}`));
    }

    // Also clean up legacy rules directory if it exists (migration)
    const bmadRulesDir = path.join(projectDir, this.configDir, 'rules', 'bmad');
    if (await fs.pathExists(bmadRulesDir)) {
      await fs.remove(bmadRulesDir);
      console.log(chalk.dim(`  Migrated from .cursor/rules/ to .cursor/commands/`));
    }
  }

  /**
   * Setup Cursor IDE configuration
   * @param {string} projectDir - Project directory
   * @param {string} bmadDir - BMAD installation directory
   * @param {Object} options - Setup options
   */
  async setup(projectDir, bmadDir, options = {}) {
    console.log(chalk.cyan(`Setting up ${this.name}...`));

    // Clean up old BMAD installation first
    await this.cleanup(projectDir);

    // Create .cursor/commands directory structure
    const cursorDir = path.join(projectDir, this.configDir);
    const commandsDir = path.join(cursorDir, this.commandsDir);
    const bmadCommandsDir = path.join(commandsDir, 'bmad');

    await this.ensureDir(bmadCommandsDir);

    // Generate agent launchers first
    const agentGen = new AgentCommandGenerator(this.bmadFolderName);
    const { artifacts: agentArtifacts } = await agentGen.collectAgentArtifacts(bmadDir, options.selectedModules || []);

    // Convert artifacts to agent format for index creation
    const agents = agentArtifacts.map((a) => ({ module: a.module, name: a.name }));

    // Get tasks, tools, and workflows (ALL workflows now generate commands)
    const tasks = await this.getTasks(bmadDir, true);
    const tools = await this.getTools(bmadDir, true);

    // Get ALL workflows using the new workflow command generator
    const workflowGenerator = new WorkflowCommandGenerator(this.bmadFolderName);
    const { artifacts: workflowArtifacts, counts: workflowCounts } = await workflowGenerator.collectWorkflowArtifacts(bmadDir);

    // Convert artifacts to workflow objects for directory creation
    const workflows = workflowArtifacts
      .filter((artifact) => artifact.type === 'workflow-command')
      .map((artifact) => ({
        module: artifact.module,
        name: path.basename(artifact.relativePath, '.md'),
        path: artifact.sourcePath,
      }));

    // Create directories for each module
    const modules = new Set();
    for (const item of [...agents, ...tasks, ...tools, ...workflows]) modules.add(item.module);

    for (const module of modules) {
      await this.ensureDir(path.join(bmadCommandsDir, module));
      await this.ensureDir(path.join(bmadCommandsDir, module, 'agents'));
      await this.ensureDir(path.join(bmadCommandsDir, module, 'tasks'));
      await this.ensureDir(path.join(bmadCommandsDir, module, 'tools'));
      await this.ensureDir(path.join(bmadCommandsDir, module, 'workflows'));
    }

    // Process and write agent launchers as commands (plain markdown)
    let agentCount = 0;
    for (const artifact of agentArtifacts) {
      // Use artifact content directly - it already has proper frontmatter
      const targetPath = path.join(bmadCommandsDir, artifact.module, 'agents', `${artifact.name}.md`);

      await this.writeFile(targetPath, artifact.content);
      agentCount++;
    }

    // Process and copy tasks as commands
    let taskCount = 0;
    for (const task of tasks) {
      const fs = require('fs-extra');
      const content = await fs.readFile(task.path, 'utf8');

      const targetPath = path.join(bmadCommandsDir, task.module, 'tasks', `${task.name}.md`);

      await this.writeFile(targetPath, content);
      taskCount++;
    }

    // Process and copy tools as commands
    let toolCount = 0;
    for (const tool of tools) {
      const fs = require('fs-extra');
      const content = await fs.readFile(tool.path, 'utf8');

      const targetPath = path.join(bmadCommandsDir, tool.module, 'tools', `${tool.name}.md`);

      await this.writeFile(targetPath, content);
      toolCount++;
    }

    // Process and copy workflow commands (generated, not raw workflows)
    let workflowCount = 0;
    for (const artifact of workflowArtifacts) {
      if (artifact.type === 'workflow-command') {
        // Use artifact content directly - it already has proper frontmatter
        const targetPath = path.join(bmadCommandsDir, artifact.module, 'workflows', `${path.basename(artifact.relativePath)}`);

        await this.writeFile(targetPath, artifact.content);
        workflowCount++;
      }
    }

    // Create BMAD index file
    await this.createBMADIndex(bmadCommandsDir, agents, tasks, tools, workflows, modules);

    console.log(chalk.green(`✓ ${this.name} configured:`));
    console.log(chalk.dim(`  - ${agentCount} agents installed`));
    console.log(chalk.dim(`  - ${taskCount} tasks installed`));
    console.log(chalk.dim(`  - ${toolCount} tools installed`));
    console.log(chalk.dim(`  - ${workflowCount} workflows installed`));
    console.log(chalk.dim(`  - Commands directory: ${path.relative(projectDir, bmadCommandsDir)}`));

    return {
      success: true,
      agents: agentCount,
      tasks: taskCount,
      tools: toolCount,
      workflows: workflowCount,
    };
  }

  /**
   * Create BMAD index file for easy navigation
   */
  async createBMADIndex(bmadCommandsDir, agents, tasks, tools, workflows, modules) {
    const indexPath = path.join(bmadCommandsDir, 'index.md');

    let content = `---
name: bmad-help
description: BMAD Method - Master Index
globs: []
alwaysApply: false
---

# BMAD Method - Cursor Commands Index

This is the master index for all BMAD agents, tasks, tools, and workflows available in your project.

## Installation Complete!

BMAD commands have been installed to: \`.cursor/commands/bmad/\`

## How to Use

Type \`/\` in Cursor chat to see all available commands:

- Agents: \`/pm\`, \`/architect\`, \`/dev\`, etc.
- Workflows: \`/workflow-status\`, \`/code-review\`, etc.
- Tasks: \`/task-name\`
- Tools: \`/tool-name\`
- This help: \`/bmad-help\`

## Available Modules

`;

    for (const module of modules) {
      content += `### ${module.toUpperCase()}\n\n`;

      // List agents for this module
      const moduleAgents = agents.filter((a) => a.module === module);
      if (moduleAgents.length > 0) {
        content += `**Agents:**\n`;
        for (const agent of moduleAgents) {
          content += `- \`/${agent.name}\` - ${agent.name}\n`;
        }
        content += '\n';
      }

      // List tasks for this module
      const moduleTasks = tasks.filter((t) => t.module === module);
      if (moduleTasks.length > 0) {
        content += `**Tasks:**\n`;
        for (const task of moduleTasks) {
          content += `- \`/${task.name}\` - ${task.name}\n`;
        }
        content += '\n';
      }

      // List tools for this module
      const moduleTools = tools.filter((t) => t.module === module);
      if (moduleTools.length > 0) {
        content += `**Tools:**\n`;
        for (const tool of moduleTools) {
          content += `- \`/${tool.name}\` - ${tool.name}\n`;
        }
        content += '\n';
      }

      // List workflows for this module
      const moduleWorkflows = workflows.filter((w) => w.module === module);
      if (moduleWorkflows.length > 0) {
        content += `**Workflows:**\n`;
        for (const workflow of moduleWorkflows) {
          content += `- \`/${workflow.name}\` - ${workflow.name}\n`;
        }
        content += '\n';
      }
    }

    content += `
## Quick Reference

- All BMAD commands are available via slash commands (type \`/\` in Cursor chat)
- Agents provide persona-based assistance with specific expertise
- Tasks are reusable workflows for common operations
- Tools provide specialized functionality
- Workflows orchestrate multi-step processes
- Each agent includes an activation block for proper initialization

## Tips

- Type \`/\` to see all available commands in the command picker
- Commands are organized by module (core, bmm, etc.)
- Use \`/bmad-help\` anytime to see this index
`;

    await this.writeFile(indexPath, content);
  }

  /**
   * Install a custom agent launcher for Cursor
   * @param {string} projectDir - Project directory
   * @param {string} agentName - Agent name (e.g., "fred-commit-poet")
   * @param {string} agentPath - Path to compiled agent (relative to project root)
   * @param {Object} metadata - Agent metadata
   * @returns {Object|null} Info about created command
   */
  async installCustomAgentLauncher(projectDir, agentName, agentPath, metadata) {
    const customAgentsDir = path.join(projectDir, this.configDir, this.commandsDir, 'bmad', 'custom', 'agents');

    if (!(await this.exists(path.join(projectDir, this.configDir)))) {
      return null; // IDE not configured for this project
    }

    await this.ensureDir(customAgentsDir);

    const launcherContent = `---
name: '${agentName}'
description: '${agentName} agent'
globs: []
alwaysApply: false
---

You must fully embody this agent's persona and follow all activation instructions exactly as specified. NEVER break character until given an exit command.

<agent-activation CRITICAL="TRUE">
1. LOAD the FULL agent file from @${agentPath}
2. READ its entire contents - this contains the complete agent persona, menu, and instructions
3. FOLLOW every step in the <activation> section precisely
4. DISPLAY the welcome/greeting as instructed
5. PRESENT the numbered menu
6. WAIT for user input before proceeding
</agent-activation>
`;

    const launcherPath = path.join(customAgentsDir, `${agentName}.md`);
    await this.writeFile(launcherPath, launcherContent);

    return {
      path: launcherPath,
      command: `/${agentName}`,
    };
  }
}

module.exports = { CursorSetup };
