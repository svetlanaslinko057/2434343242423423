/**
 * DataTable — minimal, semantic, theme-aware table for admin/web.
 *
 * Columns API:
 *   {
 *     key:    'id',                              // unique
 *     label:  'ID',                              // header
 *     align:  'left' | 'right' | 'center',       // optional, default 'left'
 *     width:  '120px' | '20%' | undefined,       // optional fixed width
 *     render: (row, idx) => ReactNode | string,  // optional custom cell
 *   }
 *
 * <DataTable
 *    columns={cols}
 *    data={rows}
 *    rowKey={(row) => row.id}
 *    onRowClick={(row) => ...}      // optional, makes the row clickable
 *    empty={<EmptyState ... />}     // shown when data.length === 0
 *    sticky                          // sticky header
 * />
 */
export function DataTable({
  columns,
  data,
  rowKey = (row, i) => row.id ?? i,
  onRowClick,
  empty,
  sticky = false,
  className = '',
  testId,
}) {
  if (!data || data.length === 0) {
    return empty || null;
  }

  return (
    <div className={`app-card overflow-hidden ${className}`} data-testid={testId} style={{ padding: 0 }}>
      <div className={sticky ? 'overflow-auto max-h-[70vh]' : 'overflow-x-auto'}>
        <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead
            className={sticky ? 'sticky top-0 z-10' : ''}
            style={{ background: 'var(--token-surface-elevated)' }}
          >
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="text-token-kicker font-semibold px-4 py-3"
                  style={{
                    textAlign: col.align || 'left',
                    width: col.width,
                    borderBottom: '1px solid var(--token-border)',
                    color: 'var(--token-text-muted)',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const k = rowKey(row, i);
              const interactive = !!onRowClick;
              return (
                <tr
                  key={k}
                  data-testid={`row-${k}`}
                  onClick={interactive ? () => onRowClick(row) : undefined}
                  className={interactive ? 'clickable' : ''}
                  style={{
                    borderTop: i === 0 ? 'none' : undefined,
                    cursor: interactive ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--token-surface-elevated)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-4 py-3 text-token-primary"
                      style={{
                        textAlign: col.align || 'left',
                        borderTop: '1px solid var(--token-border)',
                      }}
                    >
                      {col.render ? col.render(row, i) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
