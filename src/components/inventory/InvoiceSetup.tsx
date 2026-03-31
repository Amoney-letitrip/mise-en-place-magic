/**
 * InvoiceSetup — bulk-onboard ingredients from supplier invoices/receipts.
 *
 * Workflow:
 *   1. User drops up to 10 PDF/image invoice files
 *   2. Files are sent to the `scan-invoice` Edge Function (base64-encoded)
 *   3. AI returns structured ingredient rows
 *   4. User reviews / edits the extracted rows in a table
 *   5. User selects which rows to import → createIngredient mutations run
 *   6. Success toast + list refreshes
 */

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { StatusTag, Mono, SectionHead } from './StatusTag';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCreateIngredient, useCreateLot } from '@/hooks/use-inventory-data';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILES = 10;
const CATEGORIES = ['Produce', 'Protein', 'Dairy', 'Dry Goods', 'Beverages', 'Seafood', 'Bakery', 'Spices', 'Frozen', 'Other'];
const UNITS = ['lbs', 'oz', 'kg', 'g', 'ml', 'L', 'gal', 'qt', 'pint', 'fl oz', 'each', 'dozen', 'case', 'bag', 'box', 'bunch', 'head'];
const STORAGE_TYPES = ['room', 'fridge', 'freezer'] as const;

interface ExtractedIngredient {
  id: string;             // local key only
  selected: boolean;
  name: string;
  quantity: number;
  unit: string;
  cost_per_unit: number;
  total_cost: number;
  vendor_name: string;
  purchase_date: string;
  category: string;
  notes: string;
  storage_type: typeof STORAGE_TYPES[number];
  is_perishable: boolean;
  shelf_life_days: string;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (data:...;base64,)
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const InvoiceSetup = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [rows, setRows] = useState<ExtractedIngredient[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createIngredient = useCreateIngredient();
  const createLot = useCreateLot();

  const addFiles = useCallback((incoming: File[]) => {
    const MAX_FILE_SIZE_MB = 8;
    const valid = incoming.filter(f => {
      if (!ACCEPTED_TYPES.includes(f.type)) return false;
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.warning(`"${f.name}" is over ${MAX_FILE_SIZE_MB}MB and was skipped. Compress the PDF or use a smaller image.`);
        return false;
      }
      return true;
    });
    const typeFiltered = incoming.filter(f => !ACCEPTED_TYPES.includes(f.type));
    if (typeFiltered.length > 0) {
      toast.warning('Only JPG, PNG, WebP, and PDF files are supported');
    }
    setFiles(prev => {
      const combined = [...prev, ...valid];
      if (combined.length > MAX_FILES) {
        toast.warning(`Max ${MAX_FILES} files at a time`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const scanInvoices = async () => {
    if (!files.length) return;
    setScanning(true);
    setRows([]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader = session?.access_token ? `Bearer ${session.access_token}` : '';

      // Convert all files to base64 in parallel
      const encoded = await Promise.all(
        files.map(async f => ({
          base64: await toBase64(f),
          mediaType: f.type,
          filename: f.name,
        }))
      );

      const res = await fetch(`${SUPABASE_URL}/functions/v1/scan-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ files: encoded }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { ingredients } = await res.json() as { ingredients: Omit<ExtractedIngredient, 'id' | 'selected' | 'storage_type' | 'is_perishable' | 'shelf_life_days'>[] };

      const withMeta: ExtractedIngredient[] = ingredients.map(i => ({
        ...i,
        id: uid(),
        selected: true,
        vendor_name: i.vendor_name || '',
        purchase_date: i.purchase_date || '',
        category: i.category || 'Other',
        notes: i.notes || '',
        storage_type: 'room',
        is_perishable: false,
        shelf_life_days: '',
      }));

      setRows(withMeta);
      toast.success(`Found ${withMeta.length} ingredient${withMeta.length !== 1 ? 's' : ''} across ${files.length} file${files.length !== 1 ? 's' : ''}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Scan failed';
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (id: string, field: keyof ExtractedIngredient, value: unknown) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const toggleAll = (selected: boolean) => {
    setRows(prev => prev.map(r => ({ ...r, selected })));
  };

  const importSelected = async () => {
    const selected = rows.filter(r => r.selected);
    if (!selected.length) { toast.warning('No rows selected'); return; }

    setImporting(true);
    let imported = 0;
    let failed = 0;

    for (const row of selected) {
      try {
        const ingredient = await createIngredient.mutateAsync({
          name: row.name,
          unit: row.unit,
          current_stock: row.quantity,
          threshold: 0,
          reorder_qty: 0,
          vendor: row.vendor_name || null,
          cost_per_unit: row.cost_per_unit,
          is_perishable: row.is_perishable,
          shelf_life_days: row.is_perishable && row.shelf_life_days ? parseInt(row.shelf_life_days) : null,
          storage_type: row.storage_type,
          calib_factor: 1,
        } as any);

        // Create an initial lot for the purchase
        if (ingredient?.id && row.quantity > 0) {
          const expiresAt = row.is_perishable && row.shelf_life_days
            ? new Date(Date.now() + parseInt(row.shelf_life_days) * 864e5).toISOString().split('T')[0]
            : null;

          await createLot.mutateAsync({
            ingredient_id: ingredient.id,
            quantity_received: row.quantity,
            quantity_remaining: row.quantity,
            cost_per_unit: row.cost_per_unit,
            received_at: row.purchase_date
              ? new Date(row.purchase_date).toISOString()
              : new Date().toISOString(),
            expires_at: expiresAt,
            vendor: row.vendor_name || null,
            notes: row.notes || null,
          } as any);
        }

        imported++;
      } catch {
        failed++;
      }
    }

    setImporting(false);

    if (imported > 0) {
      toast.success(`Imported ${imported} ingredient${imported !== 1 ? 's' : ''}${failed ? ` · ${failed} failed` : ''}`);
      // Remove successfully imported rows
      setRows(prev => prev.filter(r => !r.selected));
    } else {
      toast.error('Import failed — check that all required fields are filled');
    }
  };

  const selectedCount = rows.filter(r => r.selected).length;

  return (
    <div className="animate-fade-up space-y-4">
      <SectionHead
        title="Invoice Setup"
        sub="Upload supplier invoices or receipts to auto-populate your ingredient list"
      />

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragging
            ? 'border-primary bg-primary/5'
            : files.length
              ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/10'
              : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          className="hidden"
          onChange={e => addFiles(Array.from(e.target.files || []))}
        />
        <div className="text-3xl mb-2">{files.length ? '📄' : '📂'}</div>
        {files.length === 0 ? (
          <>
            <div className="font-semibold text-sm mb-1">Drop invoices or receipts here</div>
            <div className="text-xs text-muted-foreground">JPG, PNG, WebP, or PDF · up to {MAX_FILES} files</div>
          </>
        ) : (
          <>
            <div className="font-semibold text-sm mb-2">
              {files.length} file{files.length !== 1 ? 's' : ''} ready
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center mb-3">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 px-2 py-1 bg-card border border-border rounded-full text-[11px] font-medium"
                >
                  {f.name.length > 24 ? f.name.slice(0, 22) + '…' : f.name}
                  <button
                    className="text-muted-foreground hover:text-red-500 transition-colors ml-0.5"
                    onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)); }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">Click to add more files</div>
          </>
        )}
      </div>

      {files.length > 0 && rows.length === 0 && (
        <Button
          className="w-full"
          disabled={scanning}
          onClick={scanInvoices}
        >
          {scanning ? '🔍 Scanning invoices…' : `✨ Scan ${files.length} Invoice${files.length !== 1 ? 's' : ''}`}
        </Button>
      )}

      {scanning && (
        <div className="bg-card border border-border rounded-lg p-4 text-center">
          <div className="text-sm text-muted-foreground animate-pulse">
            Reading invoices with AI… this takes 10–20 seconds
          </div>
        </div>
      )}

      {/* Results table */}
      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30 flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">Extracted Ingredients</span>
              <StatusTag variant="blue">{rows.length} found</StatusTag>
              <StatusTag variant="green">{selectedCount} selected</StatusTag>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>Select all</Button>
              <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>Deselect all</Button>
              <Button
                size="sm"
                disabled={importing || selectedCount === 0}
                onClick={importSelected}
              >
                {importing ? 'Importing…' : `Import ${selectedCount} ingredient${selectedCount !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-muted/50 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 text-left w-8">
                    <input
                      type="checkbox"
                      checked={selectedCount === rows.length}
                      onChange={e => toggleAll(e.target.checked)}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-left">Name</th>
                  <th className="px-3 py-2.5 text-left">Qty</th>
                  <th className="px-3 py-2.5 text-left">Unit</th>
                  <th className="px-3 py-2.5 text-left">$/Unit</th>
                  <th className="px-3 py-2.5 text-left">Category</th>
                  <th className="px-3 py-2.5 text-left">Storage</th>
                  <th className="px-3 py-2.5 text-left">Perishable</th>
                  <th className="px-3 py-2.5 text-left">Shelf Life</th>
                  <th className="px-3 py-2.5 text-left">Vendor</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr
                    key={row.id}
                    className={`border-b border-border/30 transition-colors ${row.selected ? 'bg-background' : 'bg-muted/20 opacity-60'}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={e => updateRow(row.id, 'selected', e.target.checked)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-32 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.name}
                        onChange={e => updateRow(row.id, 'name', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-16 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.quantity}
                        onChange={e => updateRow(row.id, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-20 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.unit}
                        onChange={e => updateRow(row.id, 'unit', e.target.value)}
                      >
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-20 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.cost_per_unit}
                        onChange={e => updateRow(row.id, 'cost_per_unit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-24 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.category}
                        onChange={e => updateRow(row.id, 'category', e.target.value)}
                      >
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-20 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.storage_type}
                        onChange={e => updateRow(row.id, 'storage_type', e.target.value)}
                      >
                        {STORAGE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.is_perishable}
                        onChange={e => updateRow(row.id, 'is_perishable', e.target.checked)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        placeholder="days"
                        disabled={!row.is_perishable}
                        className="w-16 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-40"
                        value={row.shelf_life_days}
                        onChange={e => updateRow(row.id, 'shelf_life_days', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-28 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        placeholder="Vendor name"
                        value={row.vendor_name}
                        onChange={e => updateRow(row.id, 'vendor_name', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        className="w-32 px-1.5 py-1 border border-border rounded text-[12px] bg-card focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={row.purchase_date}
                        onChange={e => updateRow(row.id, 'purchase_date', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="text-muted-foreground hover:text-red-500 transition-colors text-[13px]"
                        title="Remove row"
                        onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-border/30 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              Review and adjust before importing. Perishable items will create a lot with an expiry date.
            </span>
            <Button
              size="sm"
              disabled={importing || selectedCount === 0}
              onClick={importSelected}
            >
              {importing ? 'Importing…' : `Import ${selectedCount}`}
            </Button>
          </div>
        </div>
      )}

      {/* How it works */}
      {rows.length === 0 && !scanning && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="font-semibold text-[13px] mb-3">How it works</div>
          <ol className="space-y-2 text-[13px] text-muted-foreground list-decimal list-inside">
            <li>Upload one or more invoices from your food distributors (Sysco, US Foods, local suppliers, etc.)</li>
            <li>AI reads every line item — name, quantity, unit, and price</li>
            <li>Review the extracted table, adjust any values, mark perishable items</li>
            <li>Click <strong className="text-foreground">Import</strong> — ingredients and opening lots are created instantly</li>
          </ol>
          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <StatusTag variant="blue">Tip</StatusTag>
            Upload 2–3 months of past invoices to build a complete ingredient list in one shot.
          </div>
        </div>
      )}
    </div>
  );
};
