import { DEFAULT_QUANTITY_RULES } from "@engine";
import { formatNumberInput } from "../../lib/format";
import { Card } from "../../ui/Card";
import { MUTED_NOTE } from "../deal/stepShared";

interface RuleRow {
  group: string;
  name: string;
  value: string;
}

/** "sfPerBay" as "Sf per bay"; "baysPerDoubleDoor" as "Bays per double door". */
function words(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Every number under `node`, with the names on the way to it. */
function rowsOf(node: unknown, trail: string[], out: RuleRow[]): RuleRow[] {
  if (typeof node === "number") {
    const [group = "", ...rest] = trail;
    out.push({
      group: words(group),
      name: rest.length > 0 ? rest.map(words).join(" · ") : words(group),
      value: formatNumberInput(node),
    });
  } else if (typeof node === "object" && node !== null) {
    for (const [key, child] of Object.entries(node)) rowsOf(child, [...trail, key], out);
  }
  return out;
}

const ROWS = rowsOf(DEFAULT_QUANTITY_RULES, [], []);

/** The takeoff's rules of thumb (how many sf of drywall per finished sf, and so on), shown as the engine holds them. */
export function QuantityRulesSection() {
  return (
    <Card title="Quantity rules">
      <p className={MUTED_NOTE}>Read-only for now.</p>
      <div className="max-h-96 overflow-auto rounded-lg border border-line">
        <table aria-label="Quantity rules" className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-paper">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Rule
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={`${row.group}|${row.name}`} className="border-t border-line">
                <th scope="row" className="px-3 py-2 font-normal">
                  <span className="block text-xs text-muted">{row.group}</span>
                  {row.name}
                </th>
                <td className="px-3 py-2 text-right font-semibold">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
