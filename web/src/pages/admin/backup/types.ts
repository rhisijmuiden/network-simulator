export type LocationType = "ftp" | "ftps" | "scp";

export type LocationOptions = {
  implicitTls?: boolean;
  verifyCertificate?: boolean;
  tlsFingerprint?: string;
  hostKeyFingerprint?: string;
  authType?: "password" | "key";
};

export type Location = {
  id: number;
  name: string;
  type: LocationType;
  host: string;
  port: number;
  username: string;
  path: string;
  enabled: boolean;
  options: LocationOptions;
  secretSet: boolean;
};

export type LocationInput = Omit<Location, "id" | "secretSet"> & { secret: string; keyPassphrase: string };

export const defaultPorts: Record<LocationType, number> = { ftp: 21, ftps: 21, scp: 22 };

export function emptyLocation(): LocationInput {
  return {
    name: "",
    type: "scp",
    host: "",
    port: 22,
    username: "",
    path: "network-simulator",
    enabled: true,
    options: { authType: "password", verifyCertificate: true },
    secret: "",
    keyPassphrase: "",
  };
}

export type BackupSummary = {
  id: string;
  chainId: string;
  kind: "full" | "incremental";
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  hostname: string;
  totalBytes: number;
  fileCount: number;
};
