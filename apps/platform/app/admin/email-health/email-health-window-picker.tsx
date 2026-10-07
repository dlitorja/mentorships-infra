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

  // Ensure the picker's value list always includes `current` so
  // that a URL like /admin/email-health?windowDays=5 (a value
  // outside the preset list) still shows a selected option.
  const allOptions = options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b);
  const isCustom = !options.includes(current);

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
        <SelectTrigger className="w-[160px]">
          <SelectValue>
            {current} {current === 1 ? "day" : "days"}
            {isCustom && (
              <span className="text-xs text-muted-foreground ml-1">
                (custom)
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allOptions.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option} {option === 1 ? "day" : "days"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
