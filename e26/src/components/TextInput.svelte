<script>
  export let message = '';
  export let maxLength = 0;
  export let disabled = false;

  $: remaining = maxLength - new Blob([message]).size;
  $: currentLength = new Blob([message]).size;
</script>

<div class="w-full animate-fade-in" style="animation-delay: 0.1s">
  <label class="block text-sm font-medium text-gray-300 mb-2">
    要隐藏的文本
  </label>
  <div class="relative">
    <textarea
      bind:value={message}
      {disabled}
      placeholder="输入要隐藏到图片中的文本信息..."
      class="w-full h-32 px-4 py-3 bg-slate-800/50 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
    />
  </div>
  {#if maxLength > 0}
    <div class="flex justify-between mt-2 text-xs">
      <span class="text-gray-400">
        已使用: {currentLength} 字节
      </span>
      <span class={remaining < 0 ? 'text-red-400' : 'text-gray-400'}>
        剩余: {Math.max(0, remaining)} 字节
      </span>
    </div>
  {/if}
</div>
