import type { Session } from '../session.js';
import { findSkill, scanAllSkills } from '../claude/skill-scanner.js';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export type CommandHandlerResult =
  | { handled: false }
  | { handled: true; reply?: string; clearSession?: boolean; nextPrompt?: string; nextPermissionMode?: PermissionMode; nextModel?: string };

const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export function handleHelp(): CommandHandlerResult {
  return {
    handled: true,
    reply: ['/help', '/clear', '/status', '/permission [mode]', '/model [name]', '/skills', '/<skill> [args]'].join('\n'),
  };
}

export function handleClear(): CommandHandlerResult {
  return {
    handled: true,
    reply: '会话已清空。',
    clearSession: true,
  };
}

export function handleStatus(session: Session): CommandHandlerResult {
  return {
    handled: true,
    reply: `state=${session.state}\ncwd=${session.workingDirectory}\nmessages=${session.chatHistory.length}\npermission=${session.permissionMode || 'default'}\nmodel=${session.model || '(default)'}`,
  };
}

export function handlePermission(session: Session, args: string): CommandHandlerResult {
  const mode = args.trim();
  if (!mode) {
    return {
      handled: true,
      reply: `current permission mode: ${session.permissionMode || 'default'}`,
    };
  }

  if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
    return {
      handled: true,
      reply: `invalid permission mode: ${mode}\nvalid modes: ${PERMISSION_MODES.join(', ')}`,
    };
  }

  return {
    handled: true,
    reply: `permission mode switched to: ${mode}`,
    nextPermissionMode: mode as PermissionMode,
  };
}

export function handleModel(session: Session, args: string): CommandHandlerResult {
  const model = args.trim();
  if (!model) {
    return {
      handled: true,
      reply: `current model: ${session.model || '(default)'}`,
    };
  }

  return {
    handled: true,
    reply: `model switched to: ${model}`,
    nextModel: model,
  };
}

export function handleSkills(): CommandHandlerResult {
  const skills = scanAllSkills();
  if (skills.length === 0) {
    return { handled: true, reply: 'No skills found.' };
  }
  return {
    handled: true,
    reply: skills.map((skill) => `/${skill.name}${skill.description ? ` - ${skill.description}` : ''}`).join('\n'),
  };
}

export function handleSkillInvocation(text: string): CommandHandlerResult {
  const [rawName, ...rest] = text.slice(1).split(' ');
  const args = rest.join(' ').trim();
  const skills = scanAllSkills();
  const skill = findSkill(skills, rawName);
  if (!skill) {
    return {
      handled: true,
      reply: `unknown skill: ${rawName}`,
    };
  }

  return {
    handled: true,
    nextPrompt: args ? `Use the ${skill.name} skill with args: ${args}` : `Use the ${skill.name} skill.`,
  };
}
