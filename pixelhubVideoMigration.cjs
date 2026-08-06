const fs = require('fs');
const path = require('path');

const catalogPath = path.join(__dirname, 'config', 'pixelhubVideoCatalog.json');

const buildPixelHubVideoMigrationOperations = () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  return {
    defaultModelId: catalog.defaultModelId,
    defaultRouteId: catalog.defaultRouteId,
    deactivateLegacyModels: true,
    deactivateLegacyRoutes: true,
    models: catalog.models.map((model) => ({ ...model })),
    routes: catalog.routes.map((route) => ({ ...route, apiKey: null })),
  };
};

const json = (value) => JSON.stringify(Array.isArray(value) ? value : []);

const applyPixelHubVideoMigration = async (connection) => {
  const operations = buildPixelHubVideoMigrationOperations();
  await connection.execute('UPDATE video_models SET is_active = 0, is_default_model = 0');
  await connection.execute('UPDATE video_routes SET is_active = 0, is_default_route = 0');

  for (const model of operations.models) {
    await connection.execute(
      `INSERT INTO video_models (
        model_id,label,description,model_family,route_family,request_model,selector_cost,pricing_mode,point_cost_per_second,
        max_reference_images,max_reference_videos,max_total_references,reference_image_mode,supports_video_reference,
        reference_labels_json,default_aspect_ratio,aspect_ratio_options_json,default_resolution,resolution_options_json,
        default_duration,duration_options_json,prompt_max_length,supports_hd,default_hd,is_active,is_default_model,sort_order,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label), description = VALUES(description), model_family = VALUES(model_family), route_family = VALUES(route_family),
        request_model = VALUES(request_model), selector_cost = VALUES(selector_cost), pricing_mode = VALUES(pricing_mode),
        point_cost_per_second = VALUES(point_cost_per_second), max_reference_images = VALUES(max_reference_images),
        max_reference_videos = VALUES(max_reference_videos), max_total_references = VALUES(max_total_references),
        reference_image_mode = VALUES(reference_image_mode), supports_video_reference = VALUES(supports_video_reference),
        reference_labels_json = VALUES(reference_labels_json), default_aspect_ratio = VALUES(default_aspect_ratio),
        aspect_ratio_options_json = VALUES(aspect_ratio_options_json), default_resolution = VALUES(default_resolution),
        resolution_options_json = VALUES(resolution_options_json), default_duration = VALUES(default_duration),
        duration_options_json = VALUES(duration_options_json), prompt_max_length = VALUES(prompt_max_length),
        supports_hd = VALUES(supports_hd), default_hd = VALUES(default_hd), is_active = VALUES(is_active),
        is_default_model = VALUES(is_default_model), sort_order = VALUES(sort_order), updated_at = VALUES(updated_at)`,
      [
        model.id, model.label, model.description || null, model.modelFamily, model.routeFamily, model.requestModel || null,
        model.selectorCost || 0, model.pricingMode || 'fixed', model.pointCostPerSecond || 0,
        model.maxReferenceImages || 0, model.maxReferenceVideos || 0, model.maxTotalReferences || 0,
        model.referenceImageMode || 'general', model.supportsVideoReference ? 1 : 0, json(model.referenceLabels),
        model.defaultAspectRatio || '16:9', json(model.aspectRatioOptions), model.defaultResolution || '720p', json(model.resolutionOptions),
        model.defaultDuration || '4', json(model.durationOptions), model.promptMaxLength ?? null, 0, 0,
        model.isActive === false ? 0 : 1, model.isDefaultModel ? 1 : 0, model.sortOrder || 0,
        new Date(), new Date(),
      ],
    );
  }

  for (const route of operations.routes) {
    await connection.execute(
      `INSERT INTO video_routes (
        route_id,label,description,route_family,line_value,transport,mode,base_url,generate_path,task_path,upstream_model,
        use_request_model,allow_user_api_key_without_login,api_key,api_key_env,point_cost,sort_order,is_active,is_default_route,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label), description = VALUES(description), route_family = VALUES(route_family), line_value = VALUES(line_value),
        transport = VALUES(transport), mode = VALUES(mode), base_url = VALUES(base_url), generate_path = VALUES(generate_path),
        task_path = VALUES(task_path), upstream_model = VALUES(upstream_model), use_request_model = VALUES(use_request_model),
        allow_user_api_key_without_login = VALUES(allow_user_api_key_without_login), api_key = NULL, api_key_env = VALUES(api_key_env),
        point_cost = VALUES(point_cost), sort_order = VALUES(sort_order), is_active = VALUES(is_active),
        is_default_route = VALUES(is_default_route), updated_at = VALUES(updated_at)`,
      [
        route.id, route.label, route.description || null, route.routeFamily, route.line, route.transport, route.mode,
        route.baseUrl, route.generatePath, route.taskPath || null, route.upstreamModel || null, route.useRequestModel ? 1 : 0,
        route.allowUserApiKeyWithoutLogin ? 1 : 0, null, route.apiKeyEnv || null, route.pointCost || 0, route.sortOrder || 0,
        route.isActive === false ? 0 : 1, route.isDefaultRoute ? 1 : 0, new Date(), new Date(),
      ],
    );
  }
  return operations;
};

module.exports = { applyPixelHubVideoMigration, buildPixelHubVideoMigrationOperations };
