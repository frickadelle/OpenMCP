import { input } from '@inquirer/prompts';
import { banner, chapter, explain } from './ui.js';

export async function tour() {
  await banner();
  explain('Gefuehrte Vorschau', ['Diese Tour erklaert den Ablauf. Sie legt keine Datei an und ruft keine API auf.']);
  const chapters = [
    ['API importieren', ['OpenAPI ist der Bauplan deiner API: URLs, Parameter und Aktionen.',
      'Open MCP liest eine JSON- oder YAML-Datei mit diesem Bauplan.', 'Ohne Bauplan kannst du einzelne REST-Endpunkte manuell eingeben.'], 'import'],
    ['Tools auswaehlen', ['Ein API-Endpunkt wird zu einem benannten Tool.', 'Beispiel: GET /notes/{id} wird "demo_getNote".',
      'Du markierst die Tools mit der Leertaste. Unmarkierte bleiben verborgen.'], 'tools'],
    ['Zugang einstellen', ['Eine oeffentliche API braucht keinen Schluessel.', 'Bei einer privaten API traegst du den NAMEN einer Umgebungsvariable ein.',
      'Der echte Token bleibt in deiner Umgebung. Die Konfig enthaelt ihn nicht.'], 'auth'],
    ['Lokal starten', ['open-mcp.yaml speichert Quellen, Zugangsnamen und deine Tool-Auswahl.',
      'Ein Diagnosebefehl testet, ob der lokale MCP-Server funktioniert.', 'Der Beispiel-API-Server muss separat laufen; das erklaert der Wizard am Ende.'], 'local'],
    ['Client verbinden', ['Der Client ist das Programm, das Tools auflistet und aufruft.', 'Zum Testen verwenden wir MCP Inspector. Er braucht kein LLM-Konto.',
      'Export erzeugt seine Startkonfig. Der Inspector startet Open MCP dann selbst.'], 'client']
  ];
  for (const [i, [title, lines, scene]] of chapters.entries()) {
    await chapter(i + 1, title, lines, scene);
    if (process.stdin.isTTY) await input({ message: i === 4 ? 'Enter zum Abschluss' : 'Enter fuer den naechsten Schritt' });
  }
  explain('Jetzt selbst ausprobieren', ['Starte: npm run onboard', 'Waehle den lokalen Beispiel-Import. Der Wizard zeigt die naechsten Befehle.',
    'Falls schon eine Konfig existiert: node src/cli.js init --config mein-neues-projekt.yaml']);
}
