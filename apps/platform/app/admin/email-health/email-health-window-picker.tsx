"use client";

import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  current: number;
  options: number[];
};

export function EmailHealthWindowPicker({
  current,
  options,
}: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Window:</span>
      <Select
        value={String(current)}
        onValueChange={(value) => {
          const params = new URLSearchParams();
          params.set("windowDays", value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option} {option === 1 ? "day" : "days"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
