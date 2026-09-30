/** Ad-free edition: restored sponsored tabs must never load their former URL. */
export default function AdViewerPage(_props: { url: string; onClose?: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a1018] text-slate-300">
      <p>Advertising is disabled in this edition.</p>
    </div>
  );
}
