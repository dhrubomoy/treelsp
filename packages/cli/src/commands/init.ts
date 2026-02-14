/**
 * Init command - scaffold a new language project
 */

import prompts from 'prompts';
import ora from 'ora';
import pc from 'picocolors';

export async function init() {
  console.log(pc.bold('treelsp init\n'));

  const answers = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Language name:',
      initial: 'my-lang',
    },
    {
      type: 'text',
      name: 'extension',
      message: 'File extension:',
      initial: '.mylang',
    },
  ]);

  const spinner = ora('Creating project structure...').start();

  // TODO: Implement project scaffolding

  spinner.succeed('Project created!');
  console.log(pc.dim('\nNext steps:'));
  console.log(pc.dim('  1. Edit grammar.ts'));
  console.log(pc.dim('  2. Run: treelsp generate'));
  console.log(pc.dim('  3. Run: treelsp build'));
}
