-- Update pravah_context to include client_name for external memberships
CREATE OR REPLACE FUNCTION public.pravah_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_internal pravah_memberships%rowtype;
  v_external pravah_memberships%rowtype;
  v_client_name text;
begin
  select * into v_internal from pravah_memberships
  where auth_uid = auth.uid() and active and client_id is null
  order by case role when 'gc_admin' then 0 else 1 end
  limit 1;

  if v_internal.id is not null then
    return jsonb_build_object(
      'authorized', true,
      'role', v_internal.role,
      'display_name', coalesce(v_internal.display_name, v_internal.role),
      'client_id', null,
      'is_internal', true,
      'is_admin', v_internal.role = 'gc_admin'
    );
  end if;

  select * into v_external from pravah_memberships
  where auth_uid = auth.uid() and active and client_id is not null
  order by case role when 'client_admin' then 0 when 'client_viewer' then 1 else 2 end
  limit 1;

  if v_external.id is not null then
    select business_name into v_client_name from clients where id = v_external.client_id;
    return jsonb_build_object(
      'authorized', true,
      'role', v_external.role,
      'display_name', coalesce(v_external.display_name, v_external.role),
      'client_id', v_external.client_id,
      'client_name', coalesce(v_client_name, ''),
      'is_internal', false,
      'is_admin', false,
      'is_client_admin', v_external.role = 'client_admin',
      'is_closer', v_external.role = 'closer',
      'placement_id', v_external.placement_id
    );
  end if;

  return jsonb_build_object('authorized', false, 'portal_status', 'not_activated');
end $function$;
