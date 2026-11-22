import { useTranslation } from "react-i18next";
import { formatIp, isSwitch, isSwitchport, ROUTE_CODES, routingProtocols, shortName, type Device, type Simulator } from "@netsim/engine";
import { MiniTable, Section } from "./fields";

/** Live tables of a device, the way `show` commands would print them. */
export function StateView({ device, sim }: { device: Device; sim: Simulator }) {
  const { t } = useTranslation();
  const ifName = (id?: string) => shortName(device.interfaces.find((i) => i.id === id)?.name ?? "");
  const codes: Record<string, string> = { ...ROUTE_CODES, ...Object.fromEntries(routingProtocols().map((p) => [p.id, p.code])) };
  const name = (id: string) => sim.net.devices.get(id)?.name ?? "?";
  const bridge = sim.stp.bridges.get(device.id);
  const l3 = sim.net.l3Interfaces(device);
  // Unused ports without an address would only make the list long.
  const shown = device.interfaces.filter((i) => i.ip || sim.net.peer(i.id) || (i.type !== "ethernet" && i.type !== "svi"));
  const hidden = device.interfaces.length - shown.length;

  return (
    <>
      <Section title={t("state.interfaces")}>
        <MiniTable
          head={[t("state.interface"), "IP", t("state.status")]}
          rows={shown.map((i) => [shortName(i.name), i.ip ? `${i.ip.address}/${i.ip.prefix}` : "—", sim.net.status(i)])}
        />
        {hidden > 0 && <p className="text-[11px] text-muted">{t("state.unusedPorts", { count: hidden })}</p>}
      </Section>
      {(l3.length > 0 || device.defaultGateway) && (
        <Section title={t("state.routes")}>
          <MiniTable
            head={["", t("state.network"), t("state.via")]}
            empty={t("state.none")}
            rows={sim.routingTable(device.id).map((r) => [
              r.code ?? codes[r.protocol] ?? r.protocol,
              `${formatIp(r.network)}/${r.prefix}`,
              r.nextHop !== undefined ? `${formatIp(r.nextHop)}${r.protocol !== "connected" ? ` [${r.distance}/${r.metric}]` : ""}` : ifName(r.iface),
            ])}
          />
        </Section>
      )}
      {l3.length > 0 && (
        <Section title={t("state.arp")}>
          <MiniTable head={["IP", "MAC", t("state.interface")]} empty={t("state.arpEmpty")} rows={sim.arpTable(device.id).map((a) => [a.ip, a.mac, ifName(a.iface)])} />
        </Section>
      )}
      {isSwitch(device) && (
        <>
          <Section title={t("state.mac")}>
            <MiniTable head={["VLAN", "MAC", t("state.port")]} empty={t("state.macEmpty")} rows={sim.macTable(device.id).map((m) => [m.vlan, m.mac, ifName(m.port)])} />
          </Section>
          <Section title={t("state.stp")}>
            {!device.stp.enabled ? (
              <p className="text-xs text-muted">{t("state.stpOff")}</p>
            ) : bridge ? (
              <>
                <p className="text-xs">
                  {bridge.root === device.id ? t("state.isRoot") : t("state.rootIs", { name: name(bridge.root), cost: bridge.rootCost })}
                </p>
                <MiniTable
                  head={[t("state.port"), t("state.role"), t("state.portState"), t("state.cost")]}
                  rows={device.interfaces
                    .filter((i) => isSwitchport(i) && sim.net.isUp(i))
                    .map((i) => {
                      const p = sim.stpPort(i.id);
                      return [shortName(i.name), p ? t(`state.roles.${p.role}`) : "—", p ? t(`state.states.${p.state}`) : "—", p?.cost ?? ""];
                    })}
                />
              </>
            ) : (
              <p className="text-xs text-muted">{t("state.stpAlone")}</p>
            )}
          </Section>
        </>
      )}
    </>
  );
}
