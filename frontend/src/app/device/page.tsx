import type { Metadata } from "next";
import { DeviceApproval } from "./DeviceApproval";

export const metadata: Metadata = {
  title: "Connect a device",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const { user_code: userCode } = await searchParams;
  return <DeviceApproval initialUserCode={typeof userCode === "string" ? userCode : ""} />;
}
