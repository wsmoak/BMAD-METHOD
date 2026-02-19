const path = require('node:path');
const fs = require('fs-extra');
const yaml = require('yaml');
const csv = require('csv-parse/sync');
const { BaseIdeSetup } = require('./_base-ide');
const { WorkflowCommandGenerator } = require('./shared/workflow-command-generator');
const { AgentCommandGenerator } = require('./shared/agent-command-generator');
const { TaskToolCommandGenerator } = require('./shared/task-tool-command-generator');
const { getTasksFromBmad } = require('./shared/bmad-artifacts');
const { toDashPath, customAgentDashName } = require('./shared/path-utils');
const prompts = require('../../../lib/prompts');

/**
 * Codex Skills setup handler (Agent Skills format)
 * Writes skills to <project>/.agents/skills/ using agentskills.io directory format.
 * Each skill is a directory containing SKILL.md and agents/openai.yaml.
 */
class CodexSkillsSetup extends BaseIdeSetup {
  constructor() {
    super('codex-skills', 'Codex', true);
  }

  /**
   * Load manifest CSVs into lookup Maps for display name resolution.
   * @param {string} bmadDir - BMAD installation directory
   * @returns {Object} Maps for agents, tasks, and workflows
   */
  async loadManifests(bmadDir) {
    const manifests = {
      agents: new Map(),
      tasks: new Map(),
      workflows: new Map(),
    };

    // Load agent manifest
    const agentManifestPath = path.join(bmadDir, '_config', 'agent-manifest.csv');
    if (await fs.pathExists(agentManifestPath)) {
      try {
        const csvContent = await fs.readFile(agentManifestPath, 'utf8');
        const records = csv.parse(csvContent, { columns: true, skip_empty_lines: true });
        for (const record of records) {
          if (record.name) {
            manifests.agents.set(record.name, record);
            if (record.module) {
              manifests.agents.set(`${record.module}:${record.name}`, record);
            }
          }
        }
      } catch {
        // Graceful degradation
      }
    }

    // Load task manifest
    const taskManifestPath = path.join(bmadDir, '_config', 'task-manifest.csv');
    if (await fs.pathExists(taskManifestPath)) {
      try {
        const csvContent = await fs.readFile(taskManifestPath, 'utf8');
        const records = csv.parse(csvContent, { columns: true, skip_empty_lines: true });
        for (const record of records) {
          if (record.name) manifests.tasks.set(record.name, record);
        }
      } catch {
        // Graceful degradation
      }
    }

    // Load workflow manifest
    const workflowManifestPath = path.join(bmadDir, '_config', 'workflow-manifest.csv');
    if (await fs.pathExists(workflowManifestPath)) {
      try {
        const csvContent = await fs.readFile(workflowManifestPath, 'utf8');
        const records = csv.parse(csvContent, { columns: true, skip_empty_lines: true });
        for (const record of records) {
          if (record.name) manifests.workflows.set(record.name, record);
        }
      } catch {
        // Graceful degradation
      }
    }

    return manifests;
  }

  /**
   * Setup Codex Skills configuration
   * @param {string} projectDir - Project directory
   * @param {string} bmadDir - BMAD installation directory
   * @param {Object} options - Setup options
   */
  async setup(projectDir, bmadDir, options = {}) {
    if (!options.silent) await prompts.log.info(`Setting up ${this.name}...`);

    const manifests = await this.loadManifests(bmadDir);
    const destDir = path.join(projectDir, '.agents', 'skills');
    await fs.ensureDir(destDir);
    await this.clearOldBmadSkills(destDir, options);

    // Collect agents
    const agentGen = new AgentCommandGenerator(this.bmadFolderName);
    const { artifacts: agentArtifacts } = await agentGen.collectAgentArtifacts(bmadDir, options.selectedModules || []);
    const agentCount = await this.writeSkillArtifacts(destDir, agentArtifacts, manifests, 'agent');

    // Collect tasks
    const tasks = await getTasksFromBmad(bmadDir, options.selectedModules || []);
    const taskArtifacts = [];
    const ttGen = new TaskToolCommandGenerator(this.bmadFolderName);
    for (const task of tasks) {
      const content = ttGen.generateCommandContent(task, 'task');
      taskArtifacts.push({
        type: 'task',
        name: task.name,
        module: task.module,
        relativePath: path.join(task.module, 'tasks', `${task.name}.md`),
        content,
        sourcePath: task.path,
      });
    }
    const taskCount = await this.writeSkillArtifacts(destDir, taskArtifacts, manifests, 'task');

    // Collect workflows
    const workflowGen = new WorkflowCommandGenerator(this.bmadFolderName);
    const { artifacts: workflowArtifacts } = await workflowGen.collectWorkflowArtifacts(bmadDir);
    const workflowCount = await this.writeSkillArtifacts(destDir, workflowArtifacts, manifests, 'workflow');

    const written = agentCount + taskCount + workflowCount;

    if (!options.silent) {
      await prompts.log.success(
        `${this.name} configured: ${agentArtifacts.length} agents, ${workflowArtifacts.length} workflows, ${taskArtifacts.length} tasks, ${written} skills → ${destDir}`,
      );
    }

    return {
      success: true,
      counts: {
        agents: agentArtifacts.length,
        tasks: taskArtifacts.length,
        workflows: workflowArtifacts.length,
      },
      destination: destDir,
      written,
    };
  }

  /**
   * Write skill artifacts as directory-per-skill with SKILL.md and agents/openai.yaml
   * @param {string} destDir - Destination skills directory
   * @param {Array} artifacts - Artifact objects
   * @param {Object} manifests - Manifest lookup maps
   * @param {string} artifactType - 'agent', 'task', or 'workflow'
   * @returns {number} Count of skills written
   */
  async writeSkillArtifacts(destDir, artifacts, manifests, artifactType) {
    let count = 0;

    for (const artifact of artifacts) {
      // Skip workflow launchers (README files)
      if (artifact.type === 'workflow-launcher') continue;

      const skillName = toDashPath(artifact.relativePath).replace(/\.md$/, '');
      const skillDir = path.join(destDir, skillName);
      await fs.ensureDir(skillDir);

      // Write SKILL.md
      const skillContent = this.transformToSkillFormat(artifact.content, skillName, artifact);
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf8');

      // Write agents/openai.yaml
      const openaiYamlContent = this.generateOpenAiYaml(skillName, artifact, manifests, artifactType);
      const agentsDir = path.join(skillDir, 'agents');
      await fs.ensureDir(agentsDir);
      await fs.writeFile(path.join(agentsDir, 'openai.yaml'), openaiYamlContent, 'utf8');

      count++;
    }

    return count;
  }

  /**
   * Transform artifact content to agentskills.io SKILL.md format.
   * Rewrites YAML frontmatter to contain only name and description.
   * @param {string} content - Original artifact content
   * @param {string} skillName - Skill directory name (must match frontmatter name)
   * @param {Object} artifact - Artifact metadata
   * @returns {string} Transformed SKILL.md content
   */
  transformToSkillFormat(content, skillName, artifact) {
    // Strip BOM and normalize line endings
    let normalized = content
      .replace(/^\uFEFF/, '')
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n');

    let body = normalized;
    let description = artifact.description || `${skillName} skill`;

    // Parse existing frontmatter
    const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (frontmatterMatch) {
      try {
        const parsed = yaml.parse(frontmatterMatch[1]);
        if (parsed && parsed.description) {
          description = parsed.description;
        }
      } catch {
        // Use fallback description
      }
      body = frontmatterMatch[2];
    }

    // Build new frontmatter with only name and description
    const newFrontmatter = yaml.stringify({ name: skillName, description }).trimEnd();
    return `---\n${newFrontmatter}\n---\n${body}`;
  }

  /**
   * Generate agents/openai.yaml content for a skill.
   * @param {string} skillName - Skill directory name
   * @param {Object} artifact - Artifact metadata
   * @param {Object} manifests - Manifest lookup maps
   * @param {string} artifactType - 'agent', 'task', or 'workflow'
   * @returns {string} YAML content for openai.yaml
   */
  generateOpenAiYaml(skillName, artifact, manifests, artifactType) {
    const displayName = this.resolveDisplayName(skillName, artifact, manifests, artifactType);
    const shortDescription = this.resolveShortDescription(artifact, manifests, artifactType);
    const defaultPrompt = `Use $${skillName} to run BMAD ${shortDescription}.`;

    const yamlObj = {
      interface: {
        display_name: displayName,
        short_description: shortDescription,
        default_prompt: defaultPrompt,
      },
    };

    return yaml.stringify(yamlObj);
  }

  /**
   * Resolve display name from manifests with title-case fallback.
   * @param {string} skillName - Skill directory name
   * @param {Object} artifact - Artifact metadata
   * @param {Object} manifests - Manifest lookup maps
   * @param {string} artifactType - 'agent', 'task', or 'workflow'
   * @returns {string} Display name
   */
  resolveDisplayName(skillName, artifact, manifests, artifactType) {
    switch (artifactType) {
      case 'agent': {
        const key = artifact.module ? `${artifact.module}:${artifact.name}` : artifact.name;
        const entry = manifests.agents.get(key) || manifests.agents.get(artifact.name);
        if (entry && entry.title) return entry.title;

        break;
      }
      case 'task': {
        const entry = manifests.tasks.get(artifact.name);
        if (entry && entry.displayName) return entry.displayName;

        break;
      }
      case 'workflow': {
        const entry = manifests.workflows.get(artifact.name);
        if (entry && entry.name) {
          // Title-case the workflow name from manifest
          return this.titleCase(entry.name);
        }

        break;
      }
      // No default
    }

    // Fallback: title-case the skill directory name segments
    return this.titleCase(skillName);
  }

  /**
   * Resolve short description from manifests or artifact.
   * @param {Object} artifact - Artifact metadata
   * @param {Object} manifests - Manifest lookup maps
   * @param {string} artifactType - 'agent', 'task', or 'workflow'
   * @returns {string} Short description
   */
  resolveShortDescription(artifact, manifests, artifactType) {
    switch (artifactType) {
      case 'agent': {
        const key = artifact.module ? `${artifact.module}:${artifact.name}` : artifact.name;
        const entry = manifests.agents.get(key) || manifests.agents.get(artifact.name);
        if (entry && entry.role) return entry.role;

        break;
      }
      case 'task': {
        const entry = manifests.tasks.get(artifact.name);
        if (entry && entry.description) return entry.description;

        break;
      }
      case 'workflow': {
        const entry = manifests.workflows.get(artifact.name);
        if (entry && entry.description) return entry.description;

        break;
      }
      // No default
    }

    return artifact.description || `${artifact.name} ${artifactType}`;
  }

  /**
   * Title-case a hyphenated string.
   * @param {string} str - Hyphenated string
   * @returns {string} Title-cased string
   */
  titleCase(str) {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Clear old BMAD skill directories from the destination.
   * Removes directories prefixed with 'bmad' only.
   * @param {string} destDir - Skills directory
   * @param {Object} options - Options
   */
  async clearOldBmadSkills(destDir, options = {}) {
    if (!(await fs.pathExists(destDir))) return;

    let entries;
    try {
      entries = await fs.readdir(destDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.name || typeof entry.name !== 'string') continue;
      if (!entry.name.startsWith('bmad')) continue;
      if (!entry.isDirectory()) continue;

      try {
        await fs.remove(path.join(destDir, entry.name));
      } catch (error) {
        if (!options.silent) {
          await prompts.log.message(`  Skipping ${entry.name}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Detect existing BMAD skills in project
   * @param {string} projectDir - Project directory
   * @returns {boolean} True if BMAD skills found
   */
  async detect(projectDir) {
    const skillsDir = path.join(projectDir, '.agents', 'skills');
    if (!(await fs.pathExists(skillsDir))) return false;

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      return entries.some((entry) => entry.name && typeof entry.name === 'string' && entry.name.startsWith('bmad') && entry.isDirectory());
    } catch {
      return false;
    }
  }

  /**
   * Cleanup BMAD skills from project
   * @param {string} projectDir - Project directory
   */
  async cleanup(projectDir, options = {}) {
    const skillsDir = path.join(projectDir, '.agents', 'skills');
    await this.clearOldBmadSkills(skillsDir, options);
  }

  /**
   * Install a custom agent launcher as a skill
   * @param {string} projectDir - Project directory
   * @param {string} agentName - Agent name (e.g., "fred-commit-poet")
   * @param {string} agentPath - Path to compiled agent (relative to project root)
   * @param {Object} metadata - Agent metadata
   * @returns {Object|null} Info about created skill
   */
  async installCustomAgentLauncher(projectDir, agentName, agentPath, metadata) {
    const destDir = path.join(projectDir, '.agents', 'skills');
    const rawName = customAgentDashName(agentName).replace(/\.md$/, '');
    const skillDir = path.join(destDir, rawName);
    await fs.ensureDir(skillDir);

    const description = `${agentName} agent`;

    const frontmatter = yaml.stringify({ name: rawName, description }).trimEnd();
    const skillContent = `---\n${frontmatter}\n---\n
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

    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf8');

    // Write agents/openai.yaml
    const displayName = this.titleCase(agentName);
    const yamlObj = {
      interface: {
        display_name: displayName,
        short_description: description,
        default_prompt: `Use $${rawName} to run BMAD ${description}.`,
      },
    };

    const agentsDir = path.join(skillDir, 'agents');
    await fs.ensureDir(agentsDir);
    await fs.writeFile(path.join(agentsDir, 'openai.yaml'), yaml.stringify(yamlObj), 'utf8');

    return {
      path: path.relative(projectDir, path.join(skillDir, 'SKILL.md')),
      command: `$${rawName}`,
    };
  }

  /**
   * Get project-specific instructions for skills installation
   * @returns {string} Instructions text
   */
  getProjectSpecificInstructions() {
    return [
      'Codex Skills Configuration',
      '',
      'Skills installed to: <project>/.agents/skills',
      'Codex discovers skills automatically - no configuration needed.',
      'Use /skills to see available skills.',
    ].join('\n');
  }
}

module.exports = { CodexSkillsSetup };
