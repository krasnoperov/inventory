import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ProjectConfig = {
  version: 1;
  environment: string;
  spaceId: string;
  updatedAt: string;
  configPath?: string;
  projectRoot?: string;
};

const PROJECT_DIR_NAME = '.inventory';
const PROJECT_CONFIG_FILE_NAME = 'config.json';

export async function saveProjectConfig(
  input: Pick<ProjectConfig, 'environment' | 'spaceId'>,
  cwd = process.cwd()
): Promise<string> {
  const configPath = getProjectConfigPath(cwd);
  const config: ProjectConfig = {
    version: 1,
    environment: input.environment,
    spaceId: input.spaceId,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath;
}

export async function loadProjectConfig(cwd = process.cwd()): Promise<ProjectConfig | null> {
  const configPath = await findProjectConfigPath(cwd);
  if (!configPath) return null;

  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
  validateProjectConfig(parsed, configPath);
  return {
    ...parsed,
    configPath,
    projectRoot: path.dirname(path.dirname(configPath)),
  };
}

export function getProjectConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_DIR_NAME, PROJECT_CONFIG_FILE_NAME);
}

async function findProjectConfigPath(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);

  while (true) {
    const candidate = getProjectConfigPath(dir);
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function validateProjectConfig(
  config: Partial<ProjectConfig>,
  configPath: string
): asserts config is ProjectConfig {
  if (config.version !== 1) {
    throw new Error(`Unsupported Make Effects project config version in ${configPath}`);
  }
  if (!config.environment || typeof config.environment !== 'string') {
    throw new Error(`Make Effects project config is missing environment: ${configPath}`);
  }
  if (!config.spaceId || typeof config.spaceId !== 'string') {
    throw new Error(`Make Effects project config is missing spaceId: ${configPath}`);
  }
}
