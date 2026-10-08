import { useMemo } from "react";
import { buildDirectory } from "../../lib/opsMemory";
import { RecordView } from "../browse/RecordView";
import { Select } from "../ui/Select";

interface DirectoryProps {
  kind: "vm" | "project";
  files: { path: string; content: string }[];
  /** Name of the entry to show; falls back to the first one. */
  selected?: string | null;
  onSelect: (name: string) => void;
  /** Jump to a linked entry, possibly on the other tab. */
  onOpen: (kind: "vm" | "project", name: string) => void;
}

const COPY = {
  vm: { plural: "VMs", singular: "VM", choose: "Choose a VM" },
  project: { plural: "projects", singular: "project", choose: "Choose a project" },
};

/** A dropdown to pick the VM or project, and the full readable record underneath. */
export function Directory({ kind, files, selected, onSelect, onOpen }: DirectoryProps) {
  const dir = useMemo(() => buildDirectory(files), [files]);
  const all = kind === "vm" ? dir.vms : dir.projects;
  const current = all.find((e) => e.name === selected) ?? all[0];
  const text = COPY[kind];
  const content = current ? files.find((f) => f.path === current.path)?.content : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid={`directory-${kind}`}>
      <div className="flex items-center gap-3">
        <Select
          className="w-80 max-w-full"
          label={text.choose}
          value={current?.name ?? ""}
          placeholder={all.length === 0 ? `No ${text.plural} yet` : text.choose}
          options={all.map((e) => ({ value: e.name, label: e.name, hint: e.subtitle }))}
          onChange={onSelect}
        />
        <p className="text-xs text-neutral-500">
          {all.length} {all.length === 1 ? text.singular : text.plural}
        </p>
      </div>

      <section aria-label={`${text.singular} details`} className="min-h-0 min-w-0 flex-1 overflow-auto pr-1">
        {current && content !== undefined ? (
          <RecordView
            path={current.path}
            content={content}
            onOpen={onOpen}
            links={[{ label: kind === "project" ? "Runs on" : "Hosts", kind: kind === "project" ? "vm" : "project", names: current.related }]}
          />
        ) : (
          <p className="text-neutral-500">{all.length === 0 ? `No ${text.plural} recorded yet.` : `Pick a ${text.singular} above.`}</p>
        )}
      </section>
    </div>
  );
}
