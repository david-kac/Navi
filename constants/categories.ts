export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name
  color?: string;
}

// Built-in catch-all category. Not a real row in the categories table — tasks
// with category_id = null are treated as belonging to Open. Cannot be deleted
// or renamed since it doesn't exist as a database row to mutate.
export const OPEN_CATEGORY_ID = 'open';
export const OPEN_CATEGORY: Category = { id: OPEN_CATEGORY_ID, name: 'Open', icon: 'Circle' };

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'work',       name: 'Work',              icon: 'Briefcase'    },
  { id: 'marathon',   name: 'Marathon Training', icon: 'Dumbbell'     },
  { id: 'fitness',    name: 'Fitness',           icon: 'Dumbbell'     },
  { id: 'gather',     name: 'Gather',            icon: 'Sparkles'     },
  { id: 'freelance',  name: 'Freelance Design',  icon: 'Pencil'       },
  { id: 'dot',        name: 'Dot',               icon: 'Sparkles'     },
  { id: 'home',       name: 'Home / Backyard',   icon: 'Home'         },
  { id: 'family',     name: 'Family',            icon: 'Heart'        },
  { id: 'faith',      name: 'Faith',             icon: 'BookOpen'     },
  { id: 'admin',      name: 'Admin',             icon: 'ClipboardList'},
];
