import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { newId, type AclRule, type Device } from "@netsim/engine";
import { Button } from "../components/ui";
import { CommitInput, IconButton, Section, SmallSelect } from "./fields";
import { ANY, formatAddressMatch, formatPortMatch, parseAddressMatch, parsePortMatch } from "./parse";

/** Named extended ACLs: ordered rules, first match wins, implicit deny at the end. */
export function AclEditor({ device, onChange }: { device: Device; onChange: (fn: (d: Device) => void) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [current, setCurrent] = useState<string>(device.acls[0]?.name ?? "");
  const acl = device.acls.find((a) => a.name === current) ?? device.acls[0];
  const validName = /^[A-Za-z0-9_-]{1,64}$/.test(name) && !device.acls.some((a) => a.name === name);
  const setRule = (idx: number, fn: (r: AclRule) => void) =>
    onChange((d) => {
      const r = d.acls.find((a) => a.name === acl!.name)?.rules[idx];
      if (r) fn(r);
    });
  const move = (idx: number, dir: -1 | 1) =>
    onChange((d) => {
      const rules = d.acls.find((a) => a.name === acl!.name)!.rules;
      const [r] = rules.splice(idx, 1);
      rules.splice(idx + dir, 0, r!);
    });
  const usedOn = acl ? device.interfaces.filter((i) => i.aclIn === acl.name || i.aclOut === acl.name).map((i) => `${i.name} ${i.aclIn === acl.name ? "in" : "out"}`) : [];

  return (
    <>
      <Section title={t("acl.lists")}>
        <div className="flex flex-wrap gap-1.5">
          {device.acls.map((a) => (
            <button
              key={a.name}
              onClick={() => setCurrent(a.name)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${a.name === acl?.name ? "border-koraal bg-koraal/10 text-ink" : "border-line text-muted hover:text-ink"}`}
            >
              {a.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("acl.newName")}
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs focus:border-koraal focus:outline-none"
          />
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={!validName}
            onClick={() => {
              onChange((d) => void d.acls.push({ name, rules: [] }));
              setCurrent(name);
              setName("");
            }}
          >
            {t("acl.create")}
          </Button>
        </div>
        <p className="text-[11px] text-muted">{t("acl.help")}</p>
      </Section>
      {acl && (
        <Section
          title={acl.name}
          actions={
            <IconButton
              title={t("acl.delete")}
              danger
              onClick={() =>
                onChange((d) => {
                  d.acls = d.acls.filter((a) => a.name !== acl.name);
                  for (const i of d.interfaces) {
                    if (i.aclIn === acl.name) delete i.aclIn;
                    if (i.aclOut === acl.name) delete i.aclOut;
                  }
                })
              }
            >
              <Trash2 size={14} />
            </IconButton>
          }
        >
          <p className="text-[11px] text-muted">{usedOn.length ? t("acl.appliedOn", { list: usedOn.join(", ") }) : t("acl.notApplied")}</p>
          <ol className="space-y-2">
            {acl.rules.map((r, idx) => (
              <li key={r.id} className="rounded-md border border-line bg-surface p-2.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="w-8 font-mono text-[11px] text-muted">{(idx + 1) * 10}</span>
                  <div className="w-24">
                    <SmallSelect value={r.action} onChange={(v) => setRule(idx, (x) => void (x.action = v as AclRule["action"]))}>
                      <option value="permit">permit</option>
                      <option value="deny">deny</option>
                    </SmallSelect>
                  </div>
                  <div className="w-20">
                    <SmallSelect
                      value={r.protocol}
                      onChange={(v) =>
                        setRule(idx, (x) => {
                          x.protocol = v as AclRule["protocol"];
                          if (v !== "tcp" && v !== "udp") {
                            delete x.dstPort;
                            delete x.srcPort;
                          }
                        })
                      }
                    >
                      {["ip", "icmp", "tcp", "udp", "esp"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </SmallSelect>
                  </div>
                  <div className="flex-1" />
                  <IconButton title={t("acl.up")} disabled={idx === 0} onClick={() => move(idx, -1)}>
                    <ArrowUp size={13} />
                  </IconButton>
                  <IconButton title={t("acl.down")} disabled={idx === acl.rules.length - 1} onClick={() => move(idx, 1)}>
                    <ArrowDown size={13} />
                  </IconButton>
                  <IconButton title={t("common.delete")} danger onClick={() => onChange((d) => void d.acls.find((a) => a.name === acl.name)!.rules.splice(idx, 1))}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
                <div className="grid grid-cols-[48px_1fr] items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">{t("acl.source")}</span>
                  <CommitInput mono value={formatAddressMatch(r.src)} parse={parseAddressMatch} onCommit={(v) => setRule(idx, (x) => void (x.src = v))} />
                  <span className="text-[11px] font-semibold text-muted">{t("acl.destination")}</span>
                  <CommitInput mono value={formatAddressMatch(r.dst)} parse={parseAddressMatch} onCommit={(v) => setRule(idx, (x) => void (x.dst = v))} />
                  {(r.protocol === "tcp" || r.protocol === "udp") && (
                    <>
                      <span className="text-[11px] font-semibold text-muted">{t("acl.port")}</span>
                      <CommitInput
                        mono
                        value={formatPortMatch(r.dstPort)}
                        placeholder="eq 80"
                        parse={parsePortMatch}
                        onCommit={(v) => setRule(idx, (x) => (v ? (x.dstPort = v) : delete x.dstPort))}
                      />
                    </>
                  )}
                </div>
              </li>
            ))}
            <li className="rounded-md border border-dashed border-line px-2.5 py-2 font-mono text-[11px] text-muted">{t("acl.implicitDeny")}</li>
          </ol>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => onChange((d) => void d.acls.find((a) => a.name === acl.name)!.rules.push({ id: newId("a"), action: "permit", protocol: "ip", src: ANY, dst: ANY }))}
          >
            {t("acl.addRule")}
          </Button>
        </Section>
      )}
    </>
  );
}
