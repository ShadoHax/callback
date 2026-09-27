package org.json

class JSONObject(private val values: Map<String, Any?> = emptyMap()) {
    constructor(@Suppress("UNUSED_PARAMETER") text: String) : this()
    fun optString(key: String, fallback: String = ""): String = values[key] as? String ?: fallback
    fun optJSONObject(key: String): JSONObject? = values[key] as? JSONObject
    fun optJSONArray(key: String): JSONArray? = values[key] as? JSONArray
    fun optLong(key: String, fallback: Long = 0): Long = values[key] as? Long ?: fallback
}

class JSONArray(private val values: List<JSONObject> = emptyList()) {
    fun length(): Int = values.size
    fun optJSONObject(index: Int): JSONObject? = values.getOrNull(index)
}
