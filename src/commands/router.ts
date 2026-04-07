import type { Session } from '../session.js';
import {
  handleClear,
  handleHelp,
  handleModel,
  handlePermission,
  handleSkillInvocation,
  handleSkills,
  handleStatus,
  type CommandHandlerResult,
} from './handlers.js';

export type CommandResult = CommandHandlerResult;

export function routeCommand(text: string, session: Session): CommandResult {
  if (!text.startsWith('/')) {
    return { handled: false };
  }

  if (text === '/help') {
    return handleHelp();
  }

  if (text === '/clear') {
    return handleClear();
  }

  if (text === '/status') {
    return handleStatus(session);
  }

  if (text === '/skills') {
    return handleSkills();
  }

  if (text.startsWith('/permission')) {
    return handlePermission(session, text.slice('/permission'.length));
  }

  if (text.startsWith('/model')) {
    return handleModel(session, text.slice('/model'.length));
  }

  return handleSkillInvocation(text);
}
