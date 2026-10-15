"use client";

import { PrintWeek } from "@/components/schedule-builder/PrintWeek";
import { SCHEDULE_NAME } from "@/components/shell/plan-status";
import { brandFor } from "@/lib/brand";
import { useUntangleHost } from "../untangle-host";

export function PrintPage() {
  const host = useUntangleHost(brandFor("untangle"));
  return <PrintWeek host={host} backHref="/schedule" title={`${host.term.label} ${SCHEDULE_NAME}`} />;
}
