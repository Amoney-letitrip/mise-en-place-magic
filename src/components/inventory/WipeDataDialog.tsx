import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useWipeIngredientsAndRecipes } from '@/hooks/use-inventory-data';

export const WipeDataDialog = () => {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const wipeData = useWipeIngredientsAndRecipes();
  const canWipe = confirmText === 'WIPE';

  const handleWipe = async () => {
    if (!canWipe) return;
    try {
      await wipeData.mutateAsync();
      toast.success('Ingredients and recipes wiped');
      setConfirmText('');
      setOpen(false);
    } catch {
      toast.error('Failed to wipe ingredients and recipes');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={next => { setOpen(next); if (!next) setConfirmText(''); }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-[12px] text-destructive hover:text-destructive">
          Wipe data
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Wipe ingredients and recipes?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes all ingredients, lots, recipes, and recipe ingredient links in this account. Sales history and vendors are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Type WIPE to confirm
          </label>
          <input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={wipeData.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canWipe || wipeData.isPending}
            onClick={event => {
              event.preventDefault();
              handleWipe();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {wipeData.isPending ? 'Wiping...' : 'Wipe ingredients and recipes'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
