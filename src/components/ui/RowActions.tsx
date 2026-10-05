"use client";

import { Children, createContext, isValidElement, useContext, useState, type ReactNode } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import type { SvgIconComponent } from "@mui/icons-material";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import StarIcon from "@mui/icons-material/Star";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";

// One pattern for every per-row action in every list, built from the same
// Material UI pieces Material React Table uses for its own row-action menu
// (the "..." icon button, Menu, MenuItem with an icon): one button per row
// opens a menu of that row's actions (Edit, Activate/Deactivate, Delete,
// ...), so a table never turns into a wall of buttons. The same action is
// always the same icon and colour:
//   neutral  - edit / view / other non-state-changing actions
//   success  - activate / unlock
//   warning  - deactivate / lock (reversible)
//   error    - delete (permanent; always last, below a divider)
//
// Usage - a page lists its actions as <RowAction> children (in
// AdminTable's renderRowActions, or anywhere else, e.g. a card's header);
// <RowActions> turns them into the menu, or into nothing when the user
// may do none of them:
//   <RowActions>
//     {canEdit && <RowAction kind="edit" onClick={...} />}
//     {canToggle && <StatusToggleAction active={...} onClick={...} />}
//     {canDelete && <RowAction kind="delete" onClick={...} />}
//   </RowActions>

export type RowActionKind =
  | "edit"
  | "view"
  | "save"
  | "cancel"
  | "activate"
  | "deactivate"
  | "delete"
  | "lock"
  | "unlock"
  | "duplicate"
  | "default"
  | "undefault"
  | "reset"
  | "password";

type Tone = "neutral" | "success" | "warning" | "error" | "primary";

const PRESETS: Record<RowActionKind, { label: string; icon: SvgIconComponent; tone: Tone }> = {
  edit: { label: "Edit", icon: EditOutlinedIcon, tone: "neutral" },
  view: { label: "View", icon: VisibilityOutlinedIcon, tone: "neutral" },
  save: { label: "Save", icon: CheckIcon, tone: "primary" },
  cancel: { label: "Cancel", icon: CloseIcon, tone: "neutral" },
  activate: { label: "Activate", icon: PowerSettingsNewIcon, tone: "success" },
  deactivate: { label: "Deactivate", icon: BlockOutlinedIcon, tone: "warning" },
  delete: { label: "Delete", icon: DeleteOutlineIcon, tone: "error" },
  lock: { label: "Lock", icon: LockOutlinedIcon, tone: "warning" },
  unlock: { label: "Unlock", icon: LockOpenOutlinedIcon, tone: "success" },
  duplicate: { label: "Duplicate", icon: ContentCopyOutlinedIcon, tone: "neutral" },
  default: { label: "Set as default", icon: StarIcon, tone: "neutral" },
  undefault: { label: "Unset default", icon: StarOutlineIcon, tone: "neutral" },
  reset: { label: "Reset", icon: RestartAltIcon, tone: "neutral" },
  password: { label: "Reset password", icon: KeyOutlinedIcon, tone: "neutral" },
};

/** Text and icon colour of each tone (theme palette, so dark mode follows). */
const TONE_COLOR: Record<Tone, { text: string; icon: string }> = {
  neutral: { text: "text.primary", icon: "text.secondary" },
  primary: { text: "text.primary", icon: "primary.main" },
  success: { text: "success.main", icon: "success.main" },
  warning: { text: "warning.dark", icon: "warning.main" },
  error: { text: "error.main", icon: "error.main" },
};

const MenuContext = createContext<{ close: () => void } | null>(null);

export function RowAction({
  kind,
  label,
  icon,
  busy = false,
  disabled = false,
  title,
  onClick,
}: {
  kind: RowActionKind;
  /** Overrides the preset label (e.g. "Rename"). */
  label?: string;
  /** Overrides the preset icon (a Material icon). */
  icon?: SvgIconComponent;
  /** Disables the action while its request runs (the menu button shows a spinner). */
  busy?: boolean;
  disabled?: boolean;
  /** Explains the action - a tooltip, or (when disabled) shown under the label, since a disabled item can't show a tooltip. */
  title?: string;
  onClick?: () => void;
}) {
  const menu = useContext(MenuContext);
  const preset = PRESETS[kind];
  const Icon = icon ?? preset.icon;
  const color = TONE_COLOR[preset.tone];
  const off = busy || disabled;
  const menuItem = (
    <MenuItem
      dense
      disabled={off}
      onClick={() => {
        menu?.close();
        onClick?.();
      }}
      sx={{ color: color.text, minWidth: 180 }}
    >
      <ListItemIcon sx={{ color: color.icon }}>
        <Icon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={label ?? preset.label} secondary={off && title ? title : undefined} sx={{ "& .MuiListItemText-secondary": { maxWidth: 240, whiteSpace: "normal" } }} />
    </MenuItem>
  );
  const item =
    !off && title ? (
      <Tooltip title={title} placement="left">
        {menuItem}
      </Tooltip>
    ) : (
      menuItem
    );
  // Delete is permanent: always below a divider.
  return kind === "delete" ? (
    <>
      <Divider sx={{ my: 0.5 }} />
      {item}
    </>
  ) : (
    item
  );
}

/**
 * A row's "..." button and its action menu (Material UI, like Material
 * React Table's own row menu). Renders nothing when there are no actions.
 */
export function RowActions({ children, label = "Actions" }: { children: ReactNode; label?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  // Any action mid-request -> the button shows a spinner (the menu is closed by then).
  const busy = items.some((c) => isValidElement<{ busy?: boolean }>(c) && c.props.busy === true);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <Tooltip title={busy ? "Working..." : label}>
        <span>
          <IconButton
            size="small"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={Boolean(anchor)}
            disabled={busy}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            {busy ? <CircularProgress size={18} /> : <MoreHorizIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuContext.Provider value={{ close: () => setAnchor(null) }}>{items}</MenuContext.Provider>
      </Menu>
    </>
  );
}

/**
 * The Activate/Deactivate pair every status-bearing admin entity has - one
 * call site instead of the same ternary on every page.
 */
export function StatusToggleAction({ active, busy, onClick }: { active: boolean; busy?: boolean; onClick: () => void }) {
  return active ? <RowAction kind="deactivate" busy={busy} onClick={onClick} /> : <RowAction kind="activate" busy={busy} onClick={onClick} />;
}
