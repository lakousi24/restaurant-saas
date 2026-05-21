create extension if not exists "pgcrypto";

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  slug text unique not null,
  phone text,
  address text,
  logo_url text,
  favicon_url text,
  public_email text,
  maps_url text,
  primary_color text default '#ef5b3f',
  secondary_color text default '#10161d',
  accent_color text default '#f4bf4f',
  currency text default 'USD',
  language text default 'en',
  timezone text default 'Europe/Berlin',
  tax_rate numeric(5,2) not null default 0,
  service_fee numeric(10,2) not null default 0,
  terms_url text,
  privacy_url text,
  online boolean not null default true,
  temporary_closed boolean not null default false,
  preorder_enabled boolean not null default true,
  order_cutoff_time time,
  default_prep_minutes integer not null default 18,
  max_orders_per_slot integer,
  auto_print boolean not null default false,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  minimum_order numeric(10,2) not null default 0,
  free_delivery_threshold numeric(10,2),
  created_at timestamptz not null default now()
);

create table public.restaurant_staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'kitchen')),
  unique (restaurant_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  icon text,
  description text,
  sort_order integer not null default 0,
  visible boolean not null default true
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10,2) not null,
  photo_url text,
  prep_minutes integer not null default 10,
  featured boolean not null default false,
  bestseller boolean not null default false,
  spicy boolean not null default false,
  vegetarian boolean not null default false,
  ingredients text,
  allergens text,
  extras jsonb not null default '[]'::jsonb,
  sauces jsonb not null default '[]'::jsonb,
  available boolean not null default true,
  sort_order integer not null default 0
);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  min_select integer not null default 0,
  max_select integer not null default 1
);

create table public.product_option_values (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  option_id uuid not null references public.product_options(id) on delete cascade,
  name text not null,
  price_delta numeric(10,2) not null default 0
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  loyalty_points integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  order_number text unique not null,
  status text not null default 'new',
  fulfillment text not null check (fulfillment in ('pickup', 'delivery')),
  subtotal numeric(10,2) not null,
  discount_total numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_address text,
  payment_method text,
  notes text,
  estimated_ready_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null,
  unit_price numeric(10,2) not null,
  options jsonb not null default '[]'::jsonb
);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  area_label text not null,
  delivery_fee numeric(10,2) not null default 0,
  estimated_time text,
  postal_codes text[],
  radius_km numeric(10,2),
  paused boolean not null default false
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null,
  type text not null check (type in ('percent', 'fixed')),
  value numeric(10,2) not null,
  minimum_order numeric(10,2) not null default 0,
  max_redemptions integer,
  redemption_count integer not null default 0,
  first_order_only boolean not null default false,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  unique (restaurant_id, code)
);

create table public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  new_order_sound boolean not null default true,
  email_reports boolean not null default true,
  push_order_updates boolean not null default true
);

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  recipient text not null,
  subject text not null,
  type text not null,
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

alter table public.restaurants enable row level security;
alter table public.user_profiles enable row level security;
alter table public.restaurant_staff enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.promotions enable row level security;
alter table public.restaurant_hours enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.email_logs enable row level security;

create policy "Public can read active menus" on public.products for select using (available = true);
create policy "Public can read visible categories" on public.categories for select using (visible = true);
create policy "Staff can manage restaurant data" on public.restaurants for all using (
  exists (select 1 from public.restaurant_staff s where s.restaurant_id = id and s.user_id = auth.uid())
);
