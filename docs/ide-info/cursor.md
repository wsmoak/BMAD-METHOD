# BMAD Method - Cursor Instructions

## Activating Agents and Commands

BMAD commands are installed in `.cursor/commands/bmad/` as slash commands.

### How to Use

1. **Type `/` in Chat**: Opens the command picker with all available BMAD commands
2. **Direct Slash Commands**: Type `/` followed by the command name (e.g., `/pm`, `/architect`)
3. **Browse Commands**: All BMAD agents, workflows, tasks, and tools appear as slash commands

### Examples

```
/pm                 - Activate PM agent
/architect          - Activate architect agent
/dev               - Activate dev agent
/workflow-status   - Check workflow status
/code-review       - Start code review workflow
/bmad-help         - View all available BMAD commands
```

### Command Categories

- **Agents**: `/pm`, `/architect`, `/dev`, `/test`, etc.
- **Workflows**: `/workflow-status`, `/code-review`, etc.
- **Tasks**: Various reusable task commands
- **Tools**: Specialized tool commands

### Notes

- Commands are activated on-demand (alwaysApply: false)
- No automatic context pollution
- Clean, intuitive slash command interface
- Type `/` to see all available commands in the picker
