const {
  normalizeVisionaryImageRequest,
  extractVisionarySubmission,
  unwrapVisionaryTask,
} = require('./visionaryImageApi.cjs');

describe('Visionary image API contract', () => {
  it('maps the app aspect ratio and image size fields to Visionary parameters', () => {
    expect(normalizeVisionaryImageRequest({
      model: 'nano-banana-pro',
      prompt: 'night street',
      size: '4k',
      image_size: '4K',
      aspect_ratio: '16:9',
    })).toEqual({
      model: 'nano-banana-pro',
      prompt: 'night street',
      size: '16:9',
      resolution: '4K',
    });
  });

  it('reads the async task id and submitted status from the documented response envelope', () => {
    expect(extractVisionarySubmission({
      code: 200,
      data: [{ status: 'submitted', task_id: 'task-123', retry_after: 3 }],
    })).toEqual({ taskId: 'task-123', status: 'SUBMITTED' });
  });

  it('unwraps task status and image result from the documented task response', () => {
    expect(unwrapVisionaryTask({
      code: 200,
      data: {
        id: 'task-123',
        status: 'completed',
        result: { images: [{ url: ['https://cdn.example/image.png'] }] },
      },
    })).toEqual({
      id: 'task-123',
      status: 'completed',
      result: { images: [{ url: ['https://cdn.example/image.png'] }] },
    });
  });
});
