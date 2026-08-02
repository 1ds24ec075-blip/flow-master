import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, isValid, parse } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A day-first date field.
 *
 * `<input type="date">` renders in the *browser's* locale, so a US-locale
 * machine shows mm/dd/yyyy and there is no attribute that overrides it. This
 * types and displays dd/MM/yyyy while still reading and emitting ISO
 * (yyyy-MM-dd) — the shape Postgres `date` columns and the Tally serializer
 * both expect.
 */

const DISPLAY_FORMAT = "dd/MM/yyyy";
const ISO_FORMAT = "yyyy-MM-dd";

/** ISO -> dd/MM/yyyy. Empty string when unset or unparseable. */
function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = parse(String(iso).slice(0, 10), ISO_FORMAT, new Date());
  return isValid(parsed) ? format(parsed, DISPLAY_FORMAT) : "";
}

/** dd/MM/yyyy -> ISO. Null while incomplete, or when not a real calendar date. */
function displayToIso(text: string): string | null {
  const trimmed = text.trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return null;

  const parsed = parse(trimmed, DISPLAY_FORMAT, new Date());
  if (!isValid(parsed)) return null;
  // Round-trip so an overflowing day (31/02) can't silently become 03/03.
  if (format(parsed, DISPLAY_FORMAT) !== trimmed) return null;

  return format(parsed, ISO_FORMAT);
}

export interface DateFieldProps {
  /** ISO yyyy-MM-dd, or empty when unset. */
  value: string | null | undefined;
  /** Emits ISO yyyy-MM-dd, or "" when the field is cleared. */
  onChange: (isoDate: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function DateField({
  value,
  onChange,
  id,
  disabled,
  placeholder = "dd/mm/yyyy",
  className,
}: DateFieldProps) {
  const [text, setText] = React.useState(() => isoToDisplay(value));
  const [open, setOpen] = React.useState(false);

  // Re-sync when the bound value changes underneath us (different record
  // selected, edit cancelled). A half-typed date never triggers this: it can't
  // parse, so it never fired onChange, so `value` did not move.
  React.useEffect(() => {
    setText((current) => {
      const normalized = value ? String(value).slice(0, 10) : "";
      return displayToIso(current) === (normalized || null) ? current : isoToDisplay(value);
    });
  }, [value]);

  const selected = React.useMemo(() => {
    if (!value) return undefined;
    const parsed = parse(String(value).slice(0, 10), ISO_FORMAT, new Date());
    return isValid(parsed) ? parsed : undefined;
  }, [value]);

  const handleType = (next: string) => {
    setText(next);
    const iso = displayToIso(next);
    if (iso) onChange(iso);
    else if (next.trim() === "") onChange("");
  };

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(event) => handleType(event.target.value)}
        // Discard a partial or nonsense entry rather than leaving it on screen
        // looking saved.
        onBlur={() => setText(isoToDisplay(value))}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label="Pick a date"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              if (!date) return;
              setText(format(date, DISPLAY_FORMAT));
              onChange(format(date, ISO_FORMAT));
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
