package com.meta.wearable.dat.camera

class PhotoData(val data: ByteArray)
class PhotoResult {
    fun onSuccess(block: (PhotoData) -> Unit): PhotoResult {
        block(PhotoData(byteArrayOf(1)))
        return this
    }
}
class Stream { suspend fun capturePhoto(): PhotoResult = PhotoResult() }
