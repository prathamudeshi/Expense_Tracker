package com.expensetracker.capture

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class ExpenseCapturePackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == EXPENSE_CAPTURE_MODULE) ExpenseCaptureModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            EXPENSE_CAPTURE_MODULE to ReactModuleInfo(
                EXPENSE_CAPTURE_MODULE, // name
                EXPENSE_CAPTURE_MODULE, // className
                false, // canOverrideExistingModule
                false, // needsEagerInit
                false, // isCxxModule
                true // isTurboModule
            )
        )
    }
}
