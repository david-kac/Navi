export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name
  color?: string;
}

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
