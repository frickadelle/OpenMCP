import { input } from '@inquirer/prompts';
import { banner, chapter, explain } from './ui.js';

export async function tour() {
  await banner();
  explain('Guided preview', ['This tour explains the flow. It creates no files and makes no API calls.']);
  const chapters = [
    ['Import API', ['OpenAPI describes your API: URLs, parameters and actions.',
      'Open MCP reads a JSON or YAML file with that description.', 'Without a spec, define individual REST endpoints manually.'], 'import'],
    ['Choose tools', ['An API endpoint becomes a named tool.', 'Example: GET /notes/{id} becomes "demo_getNote".',
      'Select tools with Space. Unselected actions stay hidden.'], 'tools'],
    ['Set up authentication', ['A public API needs no credential.', 'For a private API, enter the NAME of an environment variable.',
      'The actual token stays in your environment. It is never saved in the configuration.'], 'auth'],
    ['Start locally', ['open-mcp.yaml stores sources, credential names and your tool selection.',
      'The doctor command tests whether the local MCP server works.', 'The example API must run separately; the wizard explains how at the end.'], 'local'],
    ['Connect client', ['The client is the program that lists and calls tools.', 'We test with MCP Inspector. It needs no LLM account.',
      'Export creates its launch configuration. Inspector then starts Open MCP itself.'], 'client']
  ];
  for (const [i, [title, lines, scene]] of chapters.entries()) {
    await chapter(i + 1, title, lines, scene);
    if (process.stdin.isTTY) await input({ message: i === 4 ? 'Press Enter to finish' : 'Press Enter for the next step' });
  }
  explain('Try it yourself', ['Start: npm run onboard', 'Choose the local example. The wizard shows the next commands.',
    'If a configuration already exists: node src/cli.js init --config my-new-project.yaml']);
}
