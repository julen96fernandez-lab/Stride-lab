/**
 * Esqueletos con la forma real de cada pantalla (mientras llegan los datos), en vez de
 * tarjetas vacías. Un brillo suave recorre las piezas; con «reducir movimiento», estático.
 */
const Bar = ({ w = "100%", h = 12, className = "" }: { w?: string | number; h?: number; className?: string }) => (
  <span className={`skel block rounded-full ${className}`} style={{ width: w, height: h }} />
);
const Block = ({ h, className = "" }: { h: number; className?: string }) => <span className={`skel block rounded-2xl ${className}`} style={{ height: h }} />;

function ChartCard({ chart = 170, title = "40%", pill = false }: { chart?: number; title?: string; pill?: boolean }) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <Bar w={title} h={10} />
      {pill && <Block h={44} className="!rounded-full" />}
      <Block h={chart} />
      <Bar w="70%" h={9} />
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="mt-3 flex flex-col gap-2">
        <Bar w="55%" h={26} />
        <Bar w="35%" h={12} />
      </div>
      <div className="card flex flex-col gap-3 p-5">
        <Bar w="20%" h={10} />
        <Bar w="45%" h={24} />
        <Bar w="85%" h={12} />
      </div>
      <div className="card flex flex-col gap-3 p-5">
        <Bar w="30%" h={10} />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="skel mx-auto block h-9 w-9 rounded-full" />
          ))}
        </div>
      </div>
      <ChartCard chart={120} />
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex gap-1.5 overflow-hidden">
        {[70, 92, 80, 76, 96].map((w, i) => (
          <span key={i} className="skel block h-[44px] flex-none rounded-full" style={{ width: w }} />
        ))}
      </div>
      <Bar w="40%" h={10} />
      {[4, 3].map((n, g) => (
        <div key={g} className="card flex flex-col gap-1 px-4 py-3">
          <div className="flex justify-between px-1 py-1">
            <Bar w="38%" h={16} />
            <Bar w="18%" h={10} />
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-line py-3">
              <span className="skel block h-12 w-12 flex-none rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Bar w="60%" h={12} />
                <Bar w="40%" h={9} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AnalysisSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <ChartCard chart={210} title="45%" />
      <ChartCard chart={170} title="25%" pill />
      <ChartCard chart={210} title="35%" pill />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Bar w="60%" h={12} />
      <div className="card flex flex-col gap-3 p-5">
        <Bar w="25%" h={10} />
        <Bar w="50%" h={44} />
        <div className="grid grid-cols-3 gap-3">
          <Bar h={22} />
          <Bar h={22} />
          <Bar h={22} />
        </div>
      </div>
      <Block h={240} className="card" />
      <ChartCard chart={160} />
    </div>
  );
}

export function ProfileSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card flex flex-col gap-4 p-5" aria-hidden="true">
      <Bar w="35%" h={10} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Bar w="40%" h={14} />
          <span className="skel block h-11 w-[90px] rounded-xl" />
        </div>
      ))}
      <Block h={52} />
    </div>
  );
}
