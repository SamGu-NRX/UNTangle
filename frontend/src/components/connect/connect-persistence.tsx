import Link from "next/link";
import { PlannerPersistencePanel } from "@/components/planner-persistence-panel";
import styles from "./connect.module.css";

export function ConnectPersistence({ count }: { count: number }) {
  return (
    <div>
      <p className={styles.lead}>
        {count} {count === 1 ? "course" : "courses"} added to your plan.
      </p>
      <p className={styles.detail}>
        Your original PDF wasn&apos;t stored. Check your courses, then keep
        planning.
      </p>
      <PlannerPersistencePanel />
      <Link className={styles.primary} href="/courses">
        Review my plan →
      </Link>
    </div>
  );
}
