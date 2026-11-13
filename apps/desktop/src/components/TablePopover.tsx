import { useState, useRef, useEffect } from "react";

type Props = {
  children: React.ReactNode;
  onSelect: (rows: number, cols: number) => void;
};

export function TablePopover({ children, onSelect }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(0);
  const [hoveredCol, setHoveredCol] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const maxRows = 10;
  const maxCols = 10;

  // Render a 10x10 grid
  const cells = [];
  for (let r = 1; r <= maxRows; r++) {
    for (let c = 1; c <= maxCols; c++) {
      const isSelected = r <= hoveredRow && c <= hoveredCol;
      cells.push(
        <div
          key={`${r}-${c}`}
          className={`table-grid-cell ${isSelected ? "selected" : ""}`}
          onMouseEnter={() => {
            setHoveredRow(r);
            setHoveredCol(c);
          }}
          onClick={() => {
            onSelect(r, c);
            setIsOpen(false);
            setHoveredRow(0);
            setHoveredCol(0);
          }}
        />
      );
    }
  }

  return (
    <div className="table-popover-container" ref={containerRef}>
      <div 
        className="table-popover-trigger" 
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
      >
        {children}
      </div>
      
      {isOpen && (
        <div className="table-popover-content">
          <div className="table-popover-header">
            {hoveredRow > 0 && hoveredCol > 0 ? `${hoveredRow} x ${hoveredCol}` : "插入表格"}
          </div>
          <div 
            className="table-popover-grid"
            onMouseLeave={() => {
              setHoveredRow(0);
              setHoveredCol(0);
            }}
          >
            {cells}
          </div>
        </div>
      )}
    </div>
  );
}
