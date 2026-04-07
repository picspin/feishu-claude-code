import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SkillInfo {
  name: string;
  description: string;
}

function parseSkillFile(filePath: string): SkillInfo | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return null;
    }
    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (!nameMatch) {
      return null;
    }
    const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);
    return {
      name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
      description: descriptionMatch ? descriptionMatch[1].trim().replace(/^["']|["']$/g, '') : '',
    };
  } catch {
    return null;
  }
}

function scanDirectory(baseDir: string): SkillInfo[] {
  if (!existsSync(baseDir)) {
    return [];
  }

  let entries: Dirent[] = [];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skill = parseSkillFile(join(baseDir, entry.name, 'SKILL.md'));
    if (skill) {
      skills.push(skill);
    }
  }
  return skills;
}

export function scanAllSkills(): SkillInfo[] {
  const userSkills = scanDirectory(join(homedir(), '.claude', 'skills'));
  const seen = new Set<string>();
  return userSkills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
  const normalized = name.toLowerCase();
  return skills.find((skill) => skill.name.toLowerCase() === normalized);
}
