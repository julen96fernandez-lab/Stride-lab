export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="block h-2.5 w-2.5 rounded-full bg-lime shadow-[0_0_0_3px_rgba(200,242,58,0.18),0_0_16px_rgba(200,242,58,0.6)]"
      />
      <span className="font-display text-[15px] font-bold tracking-[0.12em]">STRIDE LAB</span>
    </div>
  );
}
