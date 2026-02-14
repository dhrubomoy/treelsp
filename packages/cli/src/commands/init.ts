/**
 * Init command - scaffold a new language project
 */

import prompts from 'prompts';
import ora from 'ora';
import pc from 'picocolors';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function init() {
  console.log(pc.bold('treelsp init\n'));

  const answers = await prompts([
    {
      type: 'text',
      name: 'name',
      message: 'Language name:',
      initial: 'my-lang',
      validate: (value: string) => value.length > 0 || 'Name is required',
    },
    {
      type: 'text',
      name: 'extension',
      message: 'File extension:',
      initial: '.mylang',
      validate: (value: string) => {
        if (!value.startsWith('.')) return 'Extension must start with a dot';
        if (value.length < 2) return 'Extension is too short';
        return true;
      },
    },
  ]) as { name?: string; extension?: string };

  // Handle user cancellation (Ctrl+C)
  if (!answers.name || !answers.extension) {
    console.log(pc.dim('\nCancelled'));
    process.exit(0);
  }

  const { name, extension } = answers as { name: string; extension: string };

  const spinner = ora('Creating project structure...').start();

  try {
    const projectDir = resolve(process.cwd(), name);

    // Check if directory already exists
    if (existsSync(projectDir)) {
      spinner.fail(`Directory "${name}" already exists`);
      console.log(pc.dim('\nChoose a different name or remove the existing directory'));
      process.exit(1);
    }

    // Create project directory
    await mkdir(projectDir);

    // Generate package.json
    const packageJson = {
      name: name,
      version: '0.1.0',
      type: 'module',
      dependencies: {
        treelsp: '^0.0.1',
      },
      devDependencies: {
        '@treelsp/cli': '^0.0.1',
        typescript: '^5.7.3',
      },
      scripts: {
        generate: 'treelsp generate',
        build: 'treelsp build',
        watch: 'treelsp watch',
      },
    };

    await writeFile(
      resolve(projectDir, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf-8'
    );

    // Generate tsconfig.json
    const tsconfig = {
      extends: 'treelsp/tsconfig.base.json',
      compilerOptions: {
        outDir: './dist',
      },
      include: ['grammar.ts'],
    };

    await writeFile(
      resolve(projectDir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2) + '\n',
      'utf-8'
    );

    // Generate grammar.ts template
    const capitalizedName = name
      .split('-')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    const grammarTemplate = `/**
 * ${capitalizedName} - Language definition for treelsp
 */

import { defineLanguage } from 'treelsp';

export default defineLanguage({
  name: '${capitalizedName}',
  fileExtensions: ['${extension}'],
  entry: 'program',
  word: 'identifier',

  grammar: {
    // Program is a sequence of statements
    program: r => r.repeat(r.rule('statement')),

    // Define your language's statement types
    statement: r => r.choice(
      r.rule('variable_decl'),
      r.rule('expr_statement'),
    ),

    // Variable declaration: let name = value;
    variable_decl: r => r.seq(
      'let',
      r.field('name', r.rule('identifier')),
      '=',
      r.field('value', r.rule('expression')),
      ';',
    ),

    // Expression statement: expr;
    expr_statement: r => r.seq(
      r.field('expr', r.rule('expression')),
      ';',
    ),

    // Define your language's expressions
    expression: r => r.choice(
      r.rule('identifier'),
      r.rule('number'),
    ),

    // Tokens
    identifier: r => r.token(/[a-zA-Z_][a-zA-Z0-9_]*/),
    number: r => r.token(/[0-9]+/),
  },

  semantic: {
    // Program creates global scope
    program: { scope: 'global' },

    // Variable declarations introduce names
    variable_decl: {
      declares: {
        field: 'name',
        scope: 'enclosing',
      },
    },

    // Identifiers in expressions are references
    identifier: {
      references: {
        field: 'name',
        to: 'variable_decl',
        onUnresolved: 'error',
      },
    },
  },

  validation: {
    // Add your custom validation rules here
  },

  lsp: {
    // Keyword completions
    $keywords: {
      'let': { detail: 'Declare a variable' },
    },

    // Hover for variables
    variable_decl: {
      completionKind: 'Variable',
      symbol: {
        kind: 'Variable',
        label: n => n.field('name').text,
      },
      hover(node, ctx) {
        const name = node.field('name').text;
        return \`**let** \\\`\${name}\\\`\`;
      },
    },
  },
});
`;

    await writeFile(
      resolve(projectDir, 'grammar.ts'),
      grammarTemplate,
      'utf-8'
    );

    // Generate .gitignore
    const gitignore = `node_modules
dist
generated/
*.wasm
*.log
*.tsbuildinfo
.DS_Store
`;

    await writeFile(
      resolve(projectDir, '.gitignore'),
      gitignore,
      'utf-8'
    );

    // Generate README.md
    const readme = `# ${capitalizedName}

A language definition for treelsp.

## Getting Started

Install dependencies:

\`\`\`bash
npm install
# or: pnpm install
\`\`\`

Generate grammar and build parser:

\`\`\`bash
npm run generate  # Generates grammar.js, ast.ts, server.ts
npm run build     # Compiles to WASM
\`\`\`

Development workflow:

\`\`\`bash
npm run watch     # Auto-rebuild on changes
\`\`\`

## Project Structure

- \`grammar.ts\` - Language definition (grammar, semantic, validation, LSP)
- \`generated/\` - Generated files (grammar.js, WASM, types)
- \`package.json\` - Project dependencies

## Documentation

- [treelsp Documentation](https://github.com/yourusername/treelsp)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)

## License

MIT
`;

    await writeFile(
      resolve(projectDir, 'README.md'),
      readme,
      'utf-8'
    );

    spinner.succeed('Project created!');

    console.log(pc.dim('\nNext steps:'));
    console.log(pc.dim(`  cd ${name}`));
    console.log(pc.dim('  npm install'));
    console.log(pc.dim('  Edit grammar.ts to define your language'));
    console.log(pc.dim('  npm run generate'));
    console.log(pc.dim('  npm run build'));

  } catch (error) {
    spinner.fail('Failed to create project');

    if (error instanceof Error) {
      console.error(pc.red(`\n${error.message}`));
    }

    process.exit(1);
  }
}
