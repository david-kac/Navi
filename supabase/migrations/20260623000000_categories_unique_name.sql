-- Prevents duplicate category seeding races: two concurrent calls to
-- loadCategories() could both see zero rows and both insert the full
-- DEFAULT_CATEGORIES set, producing duplicate (user_id, name) pairs.
create unique index categories_user_id_name_key on public.categories (user_id, name);
