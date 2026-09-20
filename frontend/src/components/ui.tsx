import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-slate-700 shadow-sm",
        blue: "bg-near text-white hover:bg-blue-700 shadow-sm",
        secondary: "border border-line bg-white text-ink hover:bg-slate-50",
        ghost: "text-muted hover:bg-slate-100 hover:text-ink",
        subtle: "bg-blue-50 text-near hover:bg-blue-100",
      },
      size: { default: "h-11 px-5", sm: "h-9 px-3", lg: "h-12 px-6", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return <Component ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-white shadow-card", className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn("h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-near focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50", className)} {...props} />
  ),
);
Input.displayName = "Input";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-muted", className)} {...props} />;
}

export function Toggle({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (value: boolean) => void; label: string }) {
  return (
    <SwitchPrimitive.Root aria-label={label} checked={checked} onCheckedChange={onCheckedChange} className="relative h-6 w-11 rounded-full bg-slate-300 outline-none transition-colors data-[state=checked]:bg-near focus-visible:ring-4 focus-visible:ring-blue-200">
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export function SheetContent({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px]" />
      <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-white p-6 shadow-float focus:outline-none sm:p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-2xl font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="Close editor"><X size={20} /></Button></DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function importanceLabel(value: number | undefined): string {
  return value === undefined ? "Not set" : ["", "Not very important", "Slightly important", "Important", "Very important", "Essential"][value] ?? "Not set";
}
