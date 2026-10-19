import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the directory where email templates (.hbs) are located,
 * handling development (ts-node / nest start / tsx) and production (dist) runtime layouts.
 */
export function resolveTemplatesDir(currentDir: string = __dirname): string {
  const candidates = [
    path.join(currentDir, 'templates'),
    path.join(currentDir, '..', '..', 'src', 'mail', 'templates'),
    path.join(currentDir, '..', '..', '..', 'src', 'mail', 'templates'),
    path.join(currentDir, '..', '..', 'mail', 'templates'),
    path.join(process.cwd(), 'src', 'mail', 'templates'),
    path.join(process.cwd(), 'superfan.mono-backend', 'superfan.nest', 'src', 'mail', 'templates'),
    path.join(process.cwd(), 'dist', 'src', 'mail', 'templates'),
    path.join(process.cwd(), 'dist', 'mail', 'templates'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(currentDir, 'templates');
}

/**
 * Resolves the absolute path to a specific .hbs template file.
 * Handles template names with leading './', '.hbs' extensions, etc.
 */
export function resolveTemplatePath(templateName: string, currentDir: string = __dirname): string {
  const cleanName = templateName
    .trim()
    .replace(/^\.?[\/\\]+/, '')
    .replace(/\.hbs$/i, '');
  return path.join(resolveTemplatesDir(currentDir), `${cleanName}.hbs`);
}
